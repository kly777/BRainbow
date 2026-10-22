# 后端开发指南

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 技术栈

- Rust 2024 edition
- Axum 0.8
- SQLx 0.9（SQLite，`runtime-tokio` + `chrono` + `macros`）
- 数据库基础设施在 workspace crate `brainbow-db`（`crates/db/`）：连接/PRAGMA、schema 声明、迁移、自检
- tokio、tower-http、serde、chrono、tracing
- bcrypt、jsonwebtoken、reqwest、image、fsrs 等

## 入口与装配

`src/main.rs`：

1. 初始化日志（`tracing_subscriber`，默认 `info`）
2. 解析命令行模式（`app::cli`：无参数 = 启动服务，`--check` = 只读自检，`--help` = 用法）
3. 从环境变量读取 `Config`
4. 连接 SQLite（PRAGMA 集中在 `db::connect`：外键显式开启 + busy_timeout 3s + WAL/NORMAL）
5. `--check` 分支：`app::self_check::run(deep = true)` 后退出（**不迁移、不建目录、不删文件**）
6. 执行 `db::migrate`（新库直建，老库按声明 reconcile，见 [database.md](./database.md)）
7. 上传目录准备 + 启动自检（浅检查）：`app::startup::prepare_and_check`，致命问题则中止启动
8. 读记忆配置（FSRS 参数 + 调度，存于 `app_settings`）并装配 `AppState`
9. 后台任务：文件模块维护（`run_startup_maintenance`：内容哈希回填 + 正文抽取回填 + 孤儿回收）
10. 创建 Axum Router（`app/http/routes/mod.rs`：`/health`、`/api`、SPA fallback，外加提取器拒绝层与 panic 层），启动服务

### 启动自检与 `--check`

`app::self_check` 整合六项检查，输出走 tracing（`[1/6]`…`[6/6]` 前缀）：

| 项 | 内容 | 不通过时 |
|---|---|---|
| 1 | schema：`user_version`、表与列对照**声明**（`db::verify::required_tables()` 从声明派生；列比对在内存库里照声明建一遍再读 xpragma）、`PRAGMA foreign_key_check` | 缺表/缺列/版本或外键异常 → 致命；"声明之外的列"只报不算失败 |
| 2 | 完整性：`PRAGMA quick_check`（全库逐页扫描，178MB 库实测 3-20s，取决于磁盘竞争） | 只在 `--check` 里跑 |
| 3 | 上传目录：存在性、`canonicalize` 真实路径、真实写入探测的可写性 | 致命 |
| 4 | 存储一致性：缺失文件、孤儿文件、`size_bytes` 与磁盘大小不符、`category` 与 mime 推导不符（各取 20 条样本） | 只告警，不阻断 |
| 5 | 缩略图缓存：目录存在性与可写性 | 只告警（写不进去 = 每次重算，不影响功能） |
| 6 | 时间戳格式：所有 TIMESTAMP 列里非 `+00:00` 形态的行数 | 只在 `--check` 里跑；不致命但计进 `is_clean` |

- 启动只做第 1/3/4/5 项（毫秒级）；**全库扫描（第 2 项）与时间戳扫描（第 6 项）只在
  `--check` 里跑** —— 部署时或排查时各跑一次即可，避免每次重启都扫一遍全库
  （dev 下 cargo-watch 频繁重启尤其浪费）
- 致命问题 → 启动中止（非零退出码，systemd 日志可定位）；`--check` 也以非零码退出
- 一致性问题 → 启动只告警（数据问题无法靠重启解决），`--check` 计为非零退出码
- 本地复跑：`just check-backend`（连开发库）；`just deploy` 在服务就绪后自动跑一次 `--check`
- 第 6 项扫的列是从 `sqlite_master` 按 `upper(type) LIKE '%TIMESTAMP%'` **推导**的（不读
  `TIME_COLUMNS`），逐列 `COUNT(*)` 合成一条 UNION ALL —— 所以它可以发现"时间列漏登记"
- 第 1 项的列比对顺带兜住"**声明改了但 `SCHEMA_VERSION` 没抬**"：老库不会去补齐，
  启动时报"缺失列"，比留到某个查询上炸出来强
- **孤儿清理护栏**（`FileService::cleanup_orphan_files`）：库中无任何文件记录、或孤儿数 ≥5 且占比 >50% 时跳过清理并告警 —— 防止 `DATABASE_URL` 指到空库/旧备份时把整个上传目录删光
- `Config::file_upload_dir()` 是上传目录的唯一来源（上传写入、下载读取、自检共用）

运维用法：`brainbow --check`（服务器上直接跑，退出码 0 = 一切正常）。

API 路由在 `src/app/http/routes/api.rs` 统一拼接：

- 公开路由：`/user/register`、`/user/login`（限速）、`/bookmarks/favicon`、`/file` 的公开内容/预览/缩略图（私密文件仍要凭据）
- 认证路由：`/user`、`/auth/*`（API Key 管理）与各业务模块：`/mem`、`/file`、`/conv`、
  `/cards`、`/onto`、`/sign`、`/reading`、`/search`、`/bookmarks`、`/tasks`、`/calendar`、
  `/text`、`/chat`、`/ai`（独立限速桶）；`/tags` 的标签补全由 task 提供
- 管理员路由：`/admin`、`/db`（叠加 `auth` + `require_admin`）
- 每个请求组各挂自己的中间件；`/user/register`、`/user/login` 先经过登录/注册限速
- 未知 API 路径返回 JSON 404（不会落进前端 SPA fallback）

## 模块约定

业务域放在 `src/modules/<domain>/`。

推荐结构：

```
mod.rs         # axum Router::new().route(...)
handler.rs     # HTTP 层：校验 + 调用 service/query + 错误转换
service.rs     # 命令侧：写操作
query.rs       # 查询侧：只读、列表、推荐
repository.rs  # sqlx 数据访问
model.rs       # 领域模型 / DTO
```

CQRS 分离：写走 `service`，读走 `query`。单文件较小的模块可以合并，但保持 handler 不直接碰 SQL。

## SQL 写法

静态 SQL 使用编译期宏：

```rust
sqlx::query_as!(
    NoteRow,
    r#"SELECT id, name, content AS "content!: String"
       FROM text_note WHERE id = ?"#,
    id
)
```

- 可空/类型契约用 `AS "name!: Type"` 或 `AS "name?: Type"` 显式声明
- SQLite `TIMESTAMP` 列用 `COALESCE(..., '')` 覆盖为 `String`，或使用 `chrono::DateTime<Utc>`
- 动态 SQL 使用 `QueryBuilder`，例如 IN 列表、条件筛选
- 本地编译是**在线**校验（`.cargo/config.toml` 的 `[env]` 设了 `SQLX_OFFLINE=false` +
  `DATABASE_URL=sqlite:brainbow.db`）；schema 改动顺序是"先迁移库 → 再写 SQL → `just sqlx-prepare`"。
  release 构建走离线快照（`SQLX_OFFLINE=true` 且摘掉 `DATABASE_URL`）
- 新增/修改 SQL 后运行 `just sqlx-prepare` 并提交 `.sqlx/`
- schema 与迁移的入口在 `crates/db/src/schema/mod.rs`（`SCHEMA_VERSION` 与 `migrate`）；
  只读自检在 `crates/db/src/verify.rs`。应用侧的 `src/db/mod.rs` 只是 facade。
  **模块内禁止自行 `CREATE TABLE`**

## 认证

- JWT：登录后返回 token，前端在请求头携带（HS256，TTL 默认 864000s＝10 天）
- API Key：`X-API-Key`，管理在 `/api/auth/key`、`/api/auth/keys`、`/api/auth/key/{id}`；
  明文只在创建时返回一次，库里存 SHA-256
- **首个注册用户自动成为 admin**；凭据在 `app/http/auth.rs` 翻成 `Actor` 注入 request extensions，
  handler 用 `Extension(actor): Extension<Actor>`（别再要 `Claims`）。凭据有效但用户已删 → 401 `SESSION_INVALID`
- 401 触发前端全局登录弹窗
- 管理员路由在认证之上叠加 `require_admin`
- 登录/注册限速（每 IP 10 次/60s）：**键优先 `CF-Connecting-IP`**，取不到时退到 `X-Forwarded-For`
  的**最后一个**合法 IP（最靠近本进程的一跳），最后是直连 peer；**绝不取 XFF 首值** ——
  CF 对 XFF 是追加语义、客户端自填的值留在最前，按首值取键等于把限速键交给请求方。
  另有 `/api/ai` 独立桶（20 次/分钟）。见 `app/http/rate_limit.rs`

## 错误处理

统一通过 `src/shared/error_types`：service 层返回 `ServiceError`（`InvalidInput`→400 /
`NotFound`→404 / `AlreadyExists`·`InUse`·`Conflict`→409 / `Forbidden`→403 /
`Internal`·`Db`→500），带机器可读错误码（`INVALID_INPUT` / `NOT_FOUND` /
`ALREADY_EXISTS` / `RESOURCE_IN_USE` / `CONFLICT` / `FORBIDDEN` / `INTERNAL` / `DB_ERROR`）；500 的诊断只进
tracing 日志，响应体是通用文案。常用的响应构造：

```rust
error::ok_or(result, "操作名称")        // 200 或 ServiceError
error::found_or(result, "操作名称")     // 200 / 404
error::created_or(result, "操作名称")   // 201 或 ServiceError
error::deleted_or(result)               // 204 / 404
error::bad_request("参数错误")
error::not_found("资源不存在")
error::forbidden("无权操作")
error::unauthorized("请先登录")
error::session_invalid("账号不存在或已被移除，请重新登录")
error::too_many_requests("请求过于频繁，请稍后再试")
```

Handler 返回 `impl IntoResponse`，避免把 SQL 错误直接暴露给前端。成功响应复用
`shared/response.rs` 的 `ok()` / `message()` / `id()`，别在模块里重复定义同形响应。

**框架自己的拒绝也要归一到同一形**（`app/http/rejection.rs`，与 panic 层同级挂在最外层、
只对 `/api` 生效）：axum 的提取器失败时回的是 `text/plain` 英文原文（"Failed to parse the
request body as JSON: …"、"Failed to deserialize the JSON body into the target type:
missing field `name`"），未认证发一个畸形 JSON 就能看到，等于白送技术栈信息。这一层把
400/422 → `INVALID_INPUT`、415 → `UNSUPPORTED_MEDIA_TYPE`、413 → `PAYLOAD_TOO_LARGE`、
405 → `METHOD_NOT_ALLOWED` 改写成 `{code, message}`（`Allow`、CORS 等其余响应头原样保留），
原文只进 `tracing::warn` 日志（`just logs` 里看）。业务自己的 JSON 响应一律不碰。

## 配置

见 [architecture.md](./architecture.md) 的配置表。开发时 `.env.dev` 由 main 加载（仅
`debug_assertions`）；生产由 systemd 注入环境变量，不读 `.env` 文件。

路径按三层级联：单项显式配置（`DATABASE_URL` / `UPLOAD_DIR` / `BACKUP_DIR`）>
根目录约定（`BRAINBOW_ROOT` 下的 `data/<DATABASE_FILE>`、`data/uploads`、`backup`）>
开发默认（`sqlite:brainbow.db`、`uploads`；`BACKUP_DIR` 没有开发默认）。上传目录一律用
`Config::file_upload_dir()`（`{UPLOAD_DIR}/file`），别在 handler 里硬编码。

## 构建速度（2026-09-25 实测，本机 WSL：16 核 / 7.6 GB）

慢的地方不在链接、也不在 debuginfo：单 crate 47k 行（197 个文件）+ 399 个依赖，每次改动都要做一遍**整 crate 的 proc-macro 展开（几百个 sqlx `query!`）+ 类型检查**，而同一个 crate 还会被以多种单元形态（bin / check / test / clippy / musl-release）各编一遍。

| 动作 | 用时 |
|---|---|
| 无改动空跑 `cargo build` | 0.2–0.4 s |
| 注释级改动 → `cargo build`（增量热） | 1.1 s |
| 只重链（GNU ld，309 MB debug 产物） | 1.1 s |
| 改一行 → `cargo check` | 6.5 s（r-a 空闲）/ 28 s（r-a 全量索引时） |
| 本 crate 真·冷编译（无增量会话） | 53 s |
| `cargo test --no-run` / `cargo test` 全量 | 55 s / 67 s（其中约 50 s 是跑**当时**的 753 个测试；用例数已继续增长） |
| `cargo clippy --workspace --all-targets` | 60 s（冷）/ 15 s（热） |
| musl release 增量重建（`just build` 的后端部分） | 100 s |

已落地、**不要再重复讨论**的三条：

- **rust-analyzer 独占 `target/rust-analyzer`**（`.zed/settings.json` 的 `lsp.rust-analyzer.settings.cargo.targetDir = true`）：不分家时它与 cargo 抢同一把 target 锁、产物互相冲，实测同一命令慢 2–4 倍（连"什么都没改"的 build 都要等 21 s）。
- **`jobs = 8`**（`.cargo/config.toml`）：16 核但只有 7.6 GB 内存（单 rustc 峰值 1.7 GB + r-a 常驻 2 GB），并发拉满只会在全量构建时吃穿 swap。
- **不装 mold / lld**：链接只占 1.1 s，没有可省的空间；`target/debug` 里 76% 的体积是 debug info，调低 `debug` 档位只影响磁盘、不影响时间（改档位本身还要付一次全量重编）。

### 构建报 `can't find crate for ...` 时

中断的构建（Ctrl-C、cargo-watch 重启、进程被杀）会留下 **0 字节的 rlib/rmeta**，而 cargo 把它当"最新"，于是编译下游 crate 时报 `can't find crate for \`zip\`` 这类错。恢复办法：

```bash
cargo clean -p <报错的包名>                      # 正规办法
rm -rf <target 树>/.fingerprint/<包名>-*         # 构建脚本产物缺失（include!(env!("..._PATH"))）时用这个
```

必要时再清本 crate 的冗余增量会话：`rm -rf target/debug/incremental/brainbow-*`（一次可回收约 17 GB —— 每个 flag 组合一份 ~800 MB 会话且从不回收，代价是下一次改动一次 ~50 s 冷编）。
