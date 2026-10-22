# 后端架构债务报告与改造计划（Architecture Debt）

> 生成日期：2026-08-21 · 范围：src/ 全部后端（约 28,645 行 Rust）· 状态：计划落地中
> 执行分支：refactor/architecture-debt

## 1. 背景与目标

后端（Rust + axum 0.8 + sqlx/SQLite）分层纪律与测试质量良好，但存在三个结构性错误决策与若干实现级债务。本计划目标：

1. **把多用户数据边界落实为架构约束**（P0，最高优先）；
2. **把物理数据库从公共 API 中拆出**（db_viewer）；
3. **收敛双轨制错误/认证/配置体系**；
4. 全部以**小步、每阶段可验证**的方式演进，不重写。

硬约束（AGENTS.md）：不擅自 commit/push、不擅自部署；Rust 改动后 `cargo test`，涉及前端契约时 `pnpm run check && pnpm run test`；迁移 ALTER 失败必须上抛。

## 2. 现状问题清单（按严重度）

### P0（架构决策错误，必须修正）

- **P0-1 多用户数据隔离缺失**
  - 全局无 user_id 的表：mem、chunk、revlog、mem_mnemonic、onto、signifier_signified、text_note、bookmark、bookmark_tag、reading_article、reading_user_word、conv_titles、articles；对应 service/port 签名无用户维度（如 `src/modules/mem/port.rs` 40 个方法均无 user 参数）。
  - 有 user_id 但 REST 不执行：card（`card/handler.rs`/service.rs 不提取 Claims，create 落 NULL）、task（全模块无 Claims）。
  - 只有 SearchPort.search(user_id) 做过滤 —— "搜索安全、REST 裸奔"倒挂。
- **P0-2 db_viewer 把物理 schema 变成公共 API**
  - 任意表分页/筛选/排序/导出挂在 /api/db（admin-only）；schema 即 API；手写迷你查询引擎；`service.rs` 反向依赖 `handler.rs` 的 DTO（分层倒置）；可导出 password_hash / key_hash / ai_settings.api_key。

### P1（安全与错误模型）

- **P1-1 认证模型粗糙**：Claims 无 iss/aud/iat/nbf；JWT 240h 硬编码（`shared/jwt.rs`）；API key 永不过期、NULL user_id 映射 sub=-1；dev/prod 行为注释与代码漂移（`app/http/auth.rs`）。
- **P1-2 Secrets 明文入库**：app_settings 存 JWT 密钥、ai_settings 存 LLM api_key 明文。
- **P1-3 限速可绕过**：`app/http/rate_limit.rs` 信任 XFF 首个 IP 无可信代理校验；~~AI 端点无限速（成本面）~~【已修复：rate_limit_ai 已上线，20 次/分钟】。
- ~~**P1-4 CORS 默认宽松**：`main.rs` 未配置时 `CorsLayer::permissive()`~~【已修复：现为空配置不加 CORS 层、默认拒绝跨域（main.rs），2026-08-22 审计核实销账】。
- **P1-5 错误处理双轨制**：ServiceError vs `ok_or/created_or/found_or/deleted_or` 自由函数（全部抹平成 500）；`bad_request_with_code` 是空壳；`ServiceError::Db` 把原始 sqlx 错误外泄。

### P2（结构与分层）

- **P2-1 AppState 组合根膨胀**：`app/context.rs` 499 行、19 个子状态、32 个手写 FromRef；公开 `db: Arc<SqlitePool>` 导致分层泄漏（health 裸查 SQL）。
- **P2-2 mem 端口过度分层**：`mem/repository/trait_impl.rs` 230 行纯转发样板（trait+inherent 双签名）；`GLOBAL_FSRS_PARAMS` 进程级 static 与 `AppState.mem.config` 双源真相。
- **P2-3 迁移体系打补丁**：时间列 TEXT + 44 个触发器（v8/v9/v10 归一化字符串格式，v10 即重跑 v9）；create_tables 与迁移链双轨 DDL。
- **P2-4 模块耦合**：task↔time_window 双向依赖（含跨模块 ServiceError）；admin 变成全局"设置袋"；search hub 依赖 9 模块；articles/reading_article/text_note 三份同构存储。
- **P2-5 业务编排泄漏到 HTTP 层**：`chat/handler.rs` 的 chat_handler 内 tokio::spawn + SSE 协议常量（__DONE__/__ERROR__/__R__）与前端字符串契约。

### P3（实现级）

- 上传整文件内存缓冲（200MiB）；uploads 硬编码 + `config.upload_dir` 死代码；CWD 依赖（dist/uploads）。
- 媒体删除前跨 4 表全表 LIKE 引用扫描（`media/repository.rs`）。
- 后端硬编码前端路由 URL（SearchHit.url 与 `config/paths.ts` 单一来源冲突）。
- `db/query.rs` 仅剩 re-export 兼容壳（重构残留）。
- favicon 公开端点每次写缓存 sync_all + 全目录 eviction（SSRF 防护本身良好，保留）。

## 3. 目标架构原则

1. **用户边界一等公民**：所有领域表统一 user_id；服务层签名强制带用户；repository WHERE 永远含用户条件；共享数据显式建模（如 task.user_id NULL 的可见性策略化）。
2. **分层纪律**：handler 只做 HTTP 编解码；退役 ok_or 族；ServiceError + 机器可读错误码；不对外暴露原始 DB 错误。
3. **端口用在有第二实现/测试替身处**；删除双签名转发层与全局 static；FSRS 参数移入状态。
4. **db_viewer 移出生产 API**（feature-gate 或独立工具），或重构为隔离 DTO 的严格后台管理模块。
5. **搜索**：SQLite FTS5 或模块级索引替代全表 LIKE 聚合；SearchHit 只回 kind+id，URL 由前端路由映射。
6. **配置/安全收敛**：upload_dir 生效；路径基于可配置 base；CORS 默认拒绝；JWT 可配置过期 + iat/iss；限速可信代理白名单 + AI 端点限速；secrets 加密或隔离。
7. **schema 治理**：冻结时间格式（CHECK 约束 + 单一写入路径）；create_tables 与迁移链合一；schema 变更同步 `just sqlx-prepare`。

## 4. 分阶段改造计划

> 每阶段独立可合并、可验证；阶段内先写/改测试，再改实现（TDD 倾向）。

### P0 基线（准备）
- [ ] `cargo test` 全量绿并记录基线
- [ ] `just sqlx-prepare` 生成最新 .sqlx fixture
- [ ] 确认线上库备份可用（just db-pull）

### P1 数据隔离（最高优先，改动最大）

**数据归属策略（2026-08-21 定）**：
- 新增 `user_id` 列一律可空 + 建索引；**历史数据保持 NULL，不回填**（避免把数据错归给错误用户；当前开发库 80MB，手动核对后再决定是否回填）。
- 语义：`user_id IS NULL` = 共享/系统数据（对登录用户可见），与现有 task 行为一致；**新建/写入数据一律强制带 user_id**（应用层约束，服务层签名强制）。
- mem 关联表（revlog/mem_mnemonic/mem_prerequisite）通过 mem/chunk 的 user_id 间接隔离，不冗余加列（优化器仍读全量 revlog；FSRS 参数保持全局，移入 AppState 而非 static）。
- 涉及模块（改动面）：mem（端口 40 方法）、bookmark、reading、conv、text、onto、sign 的 query/service 签名补 user 参数；card/task 的 REST handler 补 Claims 提取与所有权校验。
- [ ] 迁移 v11：为全局表补 `user_id` 列（mem/chunk/revlog/mem_mnemonic/onto/signifier_signified/text_note/bookmark/bookmark_tag/reading_article/reading_user_word/conv_titles/articles），回填默认用户（当前单用户部署，成本≈0）
- [ ] 更新 mem 端口 `MemRepository` 全部方法签名带 user 维度；repository 实现过滤
- [ ] card/task REST 层补 Claims 提取与所有权校验（越权语义：404 或 403 明确其一）
- [ ] 其余全局表 service/query 签名补 user 参数
- [ ] 越权测试：用户 A 无法读/改/删用户 B 的任意表；现有搜索测试保持绿

### P2 错误统一与分层收敛
- [ ] ServiceError 统一 + 错误码注册表（机器可读 code）；退役 ok_or/created_or/found_or/deleted_or
- [ ] ServiceError::Db 不对外输出原始错误文本
- [ ] chat SSE 编排下沉 service（协议常量收敛为共享常量）
- [ ] AppState：derive 宏收敛 FromRef；摘掉公开 db 字段

### P3 mem 模块重构
- [ ] 删除 inherent+trait 双签名（MemRepo 直接实现 trait）
- [ ] GLOBAL_FSRS_PARAMS 移入 AppState（删 static；测试去掉全局锁）
- [ ] FSRS 参数优化移出请求路径（spawn_blocking / 独立 worker）

### P4 db_viewer + 搜索
- [ ] db_viewer feature-gate 或移出生产路由；消除 service→handler DTO 倒置
- [ ] 迁移 v12：FTS5 表 + 搜索改写（LIKE 聚合替换）
- [ ] SearchHit 去 URL 化，前端路由映射（同步 web 侧改动 + pnpm check/test）

### P5 安全与配置收尾
- [ ] 限速：可信代理白名单 + AI 端点限速
- [ ] JWT：iat/iss + 过期时间配置化；API key 过期策略
- [ ] CORS 默认拒绝；upload_dir 配置生效；secrets 处理
- [ ] 部署后验证：health、api-catalog、isitagentready 复扫

## 5. 完成定义（Definition of Done）

- 每阶段：`cargo test` 全绿；改动涉及前端契约时 `pnpm run check && pnpm run test` 全绿；无 unwrap/panic 新增（lint 门禁保持）
- P1 完成标志：所有领域表可枚举用户 B 数据的越权测试全通过
- 全计划完成标志：P0–P5 全部 checkbox 勾选；本文件同步为"已实施"状态