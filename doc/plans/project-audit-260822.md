# 项目缺陷审计报告（全栈）

> 日期：2026-08-22 · 范围：后端 src/、前端 web/、构建部署 deploy/+Makefile、配置、文档 doc/、测试体系 · 方法：4 路并行子代理深审 + 人工交叉复核，全部条目经源码核实并附位置
> 与 [architecture-debt.md](./architecture-debt.md) 的关系：该文档记录后端架构债务（多用户隔离/db_viewer/错误双轨制等），本报告**不重复其内容**，只收新增发现；另发现该文档一处描述已过时（见 X4）

## 总览
| 严重度 | 数量 | 分布 |
|---|---|---|
| 高 | 12 | 数据丢失/静默失败 3、匿名暴露 2、资源耗尽 1、前端异步生命周期 2、测试门禁真空 2、仓库卫生 2 |
| 中 | 24 | 部署链 6、后端正确性 4、前端 5、文档漂移 3、工程化 2、测试盲区 3、仓库卫生 1 |
| 低 | 20 | 各处健壮性与一致性 |

---

## 一、仓库与版本控制卫生

- **R1【高】.gitignore 规则顺序缺陷：env 模板实际未入库**【已修复 260822】—— `.gitignore` 中 `!.env.dev.example` / `!.env.prod.example` 白名单被第 38 行 `.*` 规则重新忽略（git check-ignore 实证），`git ls-files` 确认两模板均未被跟踪。后果：新环境克隆后无配置模板，deploy.sh 因缺 .env.prod 直接报错；且 AGENTS.md/doc 中「模板已提交」的说法失实（AGENTS.md 已同步修正）。修复：把 `.*` 规则上移到白名单之前，或改为具体点名（如 `.playwright-mcp/` `.pi/` `.zed/`）
- **R2【高】/doc 整目录不入库**【用户裁定维持现状 260822：doc 定位为个人笔记不入库；R1 修复后 env 模板已可入库】—— `.gitignore:10` `/doc` 导致全部 36 份文档（含 architecture.md/database.md/architecture-debt.md 与本报告）只在本地存在，git ls-files 计数为 0。克隆即失、无 review、无历史；AGENTS.md 要求「深入细节先查 doc/」但协作者根本拿不到。修复：移除 `/doc` 忽略并将文档入库（如确属个人笔记可拆 doc/personal/ 继续忽略）
- **R3【中】AGENTS.md 与 opencode.json 自身也被忽略**【用户裁定维持现状：doc/守则不入库；本地 db/ 历史备份清理建议已记录，请定期手动清理】—— 工作守则与破坏性命令护栏（deny reset --hard/rm -rf 等）无法随仓库传播，护栏对其他副本不生效。另：本地 db/ 目录堆积约 206MB 历史库备份、根目录 brainbow.db 87MB，易与真实数据混淆，建议定期清理或移出工作区

## 二、部署与数据安全（deploy/、Makefile）

- **D1【高】rollback 会永久删除用户上传媒体**【已修复 260822：shared/uploads 分离+符号链接】—— deploy.sh:658-661 回滚用 rm -rf $SERVICE_DIR 重建目录，而 brainbow.service WorkingDirectory=$SERVICE_DIR、media/service.rs:421 硬编码 uploads 相对路径 → 上传文件实际存于 service/uploads/；备份体系只含 DB 与代码产物，uploads 零快照，回滚前也不先备份现状。修复：回滚改用 mv 原子换目录 + 把 uploads 纳入备份/独立于 SERVICE_DIR 存放
- **D2【高】db-push/rollback 覆盖 SQLite 主库前不清理 -wal/-shm**【已修复 260822：清理+quick_check 预检+.backup 统一】—— deploy.sh:615、896 停服后直接 cp/scp 覆盖主库文件；进程退出路径无 pool.close()（main.rs:158-166 还会 process::exit 强杀），WAL/SHM 残留。旧 WAL 对新覆盖的库做 recovery 会按帧校验和重放旧事务 → 数据复活/损坏。同族问题：deploy.sh:369 部署内备份用裸 cp 而非 sqlite3 .backup（手动 db-backup 反而是事务性快照，行为不一致）。修复：覆盖前删 -wal/-shm 或统一走 .backup；启动时显式 PRAGMA journal_mode=WAL（见 B6）
- **D3【高】make deploy-web 同步到错误路径，静默失败**【已修复 260822：路径对齐 service/dist+新鲜度守卫+部署后哈希校验，见提交 3df1ec8】—— Makefile:49-51 rsync 目标 $(REMOTE_BASE)/$(APP_NAME)/dist/，而实际服务目录是 $REMOTE_BASE/$APP_NAME/service/dist（deploy.sh:83-84，Caddy DIST_DIR 同源）。执行显示成功但线上毫无变化，还在服务器留一份误导性副本。修复：对齐路径并在部署后 curl 校验 index.html 内容哈希
- **D4【中】部署中数据库备份成败被掩盖**【已修复 260822：改用 db_backup() 失败即中止】—— deploy.sh:369-373 远端命令 "cp …; echo ok" 的 echo 无条件执行，cp 失败也输出 ok，磁盘满/权限问题时带着假备份继续部署
- **D5【中】set -euo pipefail 下部署中途失败服务停摆**【已修复 260822：ERR trap 自动恢复——先拉起、不健康则用本次备份完整回滚】—— deploy.sh 先停服，后续 rsync/setup_systemd/wait_for_ready 任一失败脚本直接退出，有 backup 却无自动恢复逻辑，需人工介入
- **D6【中】ALLOW_REGISTER 三方断裂，生产被静默钉死 false**【已修复 260822：注入链补全】—— .env.prod.example 提供该变量、config.rs:77 读取，但 brainbow.service 模板与 setup_systemd 的 sed 渲染（deploy.sh:437-443）都不含它 → 改 .env.prod 被静默忽略，只能靠 admin 运行时写 DB。JWT_TTL_SECS、UPLOAD_DIR 同样无注入通道（UPLOAD_DIR 本身是 dead_code，见债务报告）
- **D7【中】JWT_SECRET 明文落盘两处**【已修复 260822：unit 600 + 清远端 /tmp】—— setup_systemd 把密钥明文渲染进 /etc/systemd/system/$APP_NAME.service（默认 644 全局可读），scp 到远端 /tmp 的中间副本也未清理（与债务「secrets 入库」不同层，属部署面）
- **D8【中】上传全量内存缓冲 × MemoryMax=1024M 余量仅约 2 倍** —— field.bytes() 将最大 210MiB 请求体整体读入内存，单次大视频即占 200MB+ RSS，约 3-4 个并发大上传触发 cgroup OOM kill（brainbow.service:14 MemoryMax=1024M），所有 in-flight 上传连带失败。【评估后暂缓：流式化需改 multipart 处理管线（axum Field::csv/body 流式落盘），方案已在债务报告 P3 记录，建议独立任务；短期可用 MemoryMax 上调或上传限速缓解】 ——
- **D9【中】make build-backend 链路必坏**【已修复 260822：同 cmd_build 口径+dist 目录补建，实测通过】—— Makefile:61-66 开头 rm -rf build 清掉旧产物，随后 cp web/dist/index.html build/dist/ 因 dist 子目录不存在失败却被 || true 吞掉 → build-backend && deploy-backend 必然报产物缺失；且用裸 cargo build --release，缺 cmd_build 的 env -u DATABASE_URL 防护，shell 里有 DATABASE_URL 时构建口径不一致
- **D10【低】备份按日期保留是静默 no-op**【已修复 260822：BACKUP_DIR 本地展开】—— deploy.sh:203-211 prune_backups 循环里 \$BACKUP_DIR 转义后由远端 shell 展开，远端并无此变量 → glob 不匹配空跑，仅靠按数量保留兜底
- **D11【低】Caddyfile /uploads/* 反代是死配置** —— 后端唯一文件路由是 /api/media/{stored_id}/file（routes/api.rs:27、media/mod.rs:41），/uploads/* 请求落到 axum fallback 返回 SPA index.html；CF 还可能按扩展名缓存这些错误 HTML
- **D12【低】Makefile 杂项**【已修复 260822：新鲜度守卫+哈希校验随 D3 落地、check-env 补 REMOTE_BASE/REMOTE_USER、caddy reload 吞错行已删；env 剥引号差异属低风险保持现状】 —— deploy-web 只校验 build/dist 存在不校验新鲜度（可发陈旧前端）；check-env 不查 REMOTE_PORT/REMOTE_USER/REMOTE_BASE（缺失时报错晦涩）；deploy-web 的 caddy reload 失败被吞；-include .env.prod 不剥引号与 deploy.sh source 行为不一致

## 三、后端安全与正确性（architecture-debt.md 之外）

- **B1【高】/api/text 整模块无认证，匿名可读写并一键清空笔记**【已修复 260822：移入认证组】 —— routes/api.rs:26 将 text 模块整体挂在公开组，GET/PUT 无任何身份提取器；save_tabs 是「DELETE 全表再重插」的替换写（text/repository.rs:40-59）。公网任何人可读/篡改/**清空全部文本笔记**或当免费存储。text_note 在 v11 刚补了 user_id，匿名写大概率非有意设计。与债务 P0-1 不同：那是「登录用户间隔离缺失」，这是「连登录都不需要」。修复：挪进 authed 组或明确产品化公开语义
- **B2【高】favicon 公开端点无流式大小上限，可 OOM DoS**【已修复 260822：read_bounded 流式限读】—— bookmark/favicon.rs:187 首页 HTML 用 resp.text() 整读无上限；favicon.ico 分支对 chunked 响应先 bytes() 全量入内存后才做 512KB 后置检查（198-204）。该端点无认证不限速：攻击者自控域名返回超大 chunked 响应并并发请求即可内存耗尽。修复：流式读取 + 字节计数硬截断；顺带给端点挂限速
- **B3【中】书签导入绕过 URL scheme 校验 → 存储型 XSS**【已修复 260822：导入复用 validate_url+测试】—— create/update 走 validate_url 只允许 http/https（service.rs:27），但 import_netscape_html 直插 repo.create 不校验（service.rs:164-166、import_html.rs:52-58）；前端 BookmarkItem.tsx:28 等以 <a href> 原样渲染。导入含 javascript: HREF 的书签文件（如他人分享的导出）后点击即触发。修复：导入路径复用 validate_url 或入库时白名单过滤
- **B4【中】FSRS 复习是无事务、无乐观锁的裸读-算-写**【已修复 260822：review_mem_atomic 单事务+双守卫乐观锁+409 冲突】—— mem/service.rs:125-198：get_mem 读基线 → 内存计算 → UPDATE 无旧值守卫（trait_impl.rs:840）→ insert_revlog 又是独立语句。并发复习（双开标签页）可丢失更新、revlog 出现重复 before 样本污染 FSRS 参数优化、UPDATE 与 revlog 脱节。修复：单事务 + WHERE stability=旧值 乐观锁
- **B5【中】时间窗冲突检测完全不展开递归规则**【已修复 260822：expand_between 确定性展开+检测改造】—— task/service.rs:144-221 的 validate_time_windows 只比较窗口基线 [start,end]，recurrence_rule 字段全库只有存取往返、无任何展开逻辑 → daily/weekly/monthly 规则下重叠检测形同虚设
- **B6【中】journal_mode/synchronous 未显式配置**【已修复 260822：启动显式 WAL+NORMAL，见提交 15361b1】—— main.rs:97-99 仅设 busy_timeout 3s；经 sqlx-sqlite-0.9.0 源码核实默认不设置 journal_mode（foreign_keys 默认 ON 无忧）。journal_mode 是文件级持久属性：当前开发库恰好已是 WAL，但**新建部署落回 DELETE journal**，87MB 库上读写互斥、busy_timeout 3s 到期即 SQLITE_BUSY→500。池为 sqlx 默认 max_connections=10/acquire_timeout=30s。修复：启动显式 PRAGMA journal_mode=WAL（兼修 D2）
- **B7【低】logout 是空壳**【评估后暂缓：服务端作废需 token 版本号/黑名单基建（改密作废同理），体量超审计批次；缓解面已有——admin 轮换密钥可全量作废】—— user/handler.rs:110-112 仅 response::ok()，无黑名单/jti/token 版本；改密码也不作废旧 token（JWT TTL 10 天）。缓解：admin 可轮换密钥全量作废
- **B8【低】CSV 导出公式注入**【已修复 260822：shared::csv::sanitize_cell 双导出接入】—— mem/query.rs:213-232 与 db_viewer/handler.rs:244-279 只做 RFC4180 引号转义，未中和 =/+/-/@ 开头单元格；db_viewer 可导出含用户内容的表，多用户化后有向 admin 表格注入公式的面（当前 admin-only 故低）
- **B9【低】review 的 rating/duration_secs 无范围校验**【已修复 260822：1..=4 + finite/0..86400】—— mem/dto.rs:17-23：rating u8 未限 1..=4，fsrs/mod.rs:75-80 的 _ 兜底臂把 0 和 ≥5 全按 Easy 处理还会清零 lapses；duration 接受 NaN/负数污染统计
- **B10【低】v12 FTS5 索引零消费 + REPLACE 腐化埋雷**【评估后暂缓：消费（接 MATCH 搜索）或拆除属产品方向选择；建议在首个 MATCH 查询落地前一并处理 recursive_triggers 风险】—— db/mod.rs:988-1110 建 10 张 FTS 表+30 触发器，全库无一处 MATCH 查询（唯一引用是 db_viewer 排除它们）：每次写白付维护成本；将来若出现 INSERT OR REPLACE 写路径（现仅 app_settings 一处且非 FTS 表），recursive_triggers 默认 OFF 时 delete 触发器不触发，索引静默腐化
- **B11【低】favicon 解析字节偏移 panic 风险（待确认可达性）**【已修复 260822：ascii_lower 保持字节对齐，无论可达性均消除 panic 面】—— favicon.rs:222-244 把 to_lowercase() 副本的字节索引用回原串，İ(U+0130) 等 lowercase 改变字节长度时切片可能落在非 char boundary → 单请求 panic 连接中断（进程不崩）
- **B12【低】media 白名单声明 SVG 但永远传不进去**【已修复 260822：死选项移除，存量兼容分支保留】 —— 上传要求 infer magic bytes 与声明 MIME 完全一致，SVG 文本格式无固定 magic → 实际不可上传，handler.rs 对 svg 的 attachment 特判是不可达分支（功能死选项而非安全问题；存量 SVG 已有 octet-stream+attachment 缓解）

## 四、前端缺陷（web/src/）

- **F1【高】chat 流式生成无卸载中止，离开页面 SSE 继续后台跑**【已修复 260822：onCleanup abort】—— useStreamChat.ts:37-40,107-131：abortCtrl 仅停止按钮可触发，全模块无 onCleanup(stopStreaming)。生成中切换路由/会话 → 后端持续生成烧 token、rAF 持续 patch 已卸载页面的 signal，完成后 loadTree(旧id) 把界面拉回旧树。修复：hook 内 onCleanup(() => abort())
- **F2【高】streaming.ts 读循环无 try/finally、不 cancel reader**【已修复 260822】—— streaming.ts:56-71：onChunk 抛错（__ERROR__ 路径正是回调内 throw，streamChatRequest.ts:45）直接逃出 while 循环，reader 未 cancel/releaseLock，连接保持到服务端生成完毕。补 try/finally + reader.cancel()
- **F3【中】会话树切换竞态：晚到响应覆盖新树**【已修复 260822：双时效守卫】—— useTreeList.ts:68-71 对 treeId 变化的 loadTree 无时效守卫（乱序完成后到者胜）；useStreamChat.ts:119-121 流完成后无条件加载发起时的旧树。快速连点两个会话会出现 URL 与内容不一致
- **F4【中】uploadMedia 成功后不失效媒体缓存**【已修复 260822：tapInvalidate 补齐】—— media/api.ts:32-41 无 tapInvalidate（同文件 rename/delete 均有），上传后 30-60s 内列表看不到新条目。其余全部写路径已逐一核对均有失效，此为唯一缺口
- **F5【中】Markdown 白名单全局放行 style/img，AI 内容有注入面**【大部分修复 260822：style 经 hook 收敛到 .katex 子树、id 移出白名单；外链 <img> 策略维持现状待用户裁定（CSP img-src https: 允许外域，收紧破坏笔记外链图片）】—— MarkdownCore.tsx:126-149 ALLOWED_ATTR 含 style 且对全部标签生效、img 允许 https 外链，AI 输出经此渲染。提示注入可携带追踪像素与内联 CSS（background:url 外呼、position:fixed 覆盖层页内钓鱼）。高危协议（javascript:/data:/vbscript:）已实测被拦截，风险集中在 style 收敛（建议仅 KaTeX 所需元素）与外链图片策略
- **F6【中】Modal 无焦点管理，Escape 实际失效**【已修复 260822：移焦/Tab 圈闭/还原+document 级 Escape；多层叠开全关为已知限制】—— organisms/Modal.tsx:42-73：打开不移焦、无焦点圈闭、关闭不还原；Escape 监听挂在 overlay div 但焦点从未进入其子树 → 键盘用户关不掉，aria-modal 形同虚设
- **F7【中】凭证明文 localStorage（纵深防御问题）**【评估后暂缓：HttpOnly Cookie 迁移需重构认证流（CSRF 防护/API 形态），超出审计修复批次体量，建议独立任务；注入面已由 F5 style 收敛与 DOMPurify 白名单压薄】—— token.ts:7,46-64 存 JWT 与 API key 明文；当前 sanitize 无实际绕过，但任何注入一旦成立即可窃取长效凭证（JWT 10 天）。建议评估 HttpOnly cookie 或缩短前端可见凭证寿命
- **F8【低】Markdown 标题 id 跨实例必然重复**【已修复 260822：实例前缀+内容 id 不再放行】—— MarkdownCore.tsx:182-190 md-h-N 计数与实例无关，聊天页多条消息必产生重复 DOM id（锚点跳错）；ALLOWED_ATTR 同时放行内容自带 id 加剧碰撞
- **F9【低】两处认证判定不一致**【已修复 260822：统一 user||apiKey】—— HomeGuard.tsx:13 只认 auth().user，AuthGuard.tsx:22 认 user||apiKey：纯 API Key 场景首页显示未登录着陆页而内页放行
- **F10【低】Tooltip 读屏不可达**【已修复 260822：aria-describedby 关联】—— Tooltip.tsx:94-103 气泡 Portal 渲染但无 aria-describedby 关联，role=tooltip 内容读屏拿不到

## 五、工程化与配置

- **E1【中】CI 全缺位**【用户裁定维持现状 260822：不使用 GitHub Actions；质量门禁以 AGENTS.md 提交前清单本地手动执行为准（曾短暂引入 ci.yml，已按裁定移除）；顺带清零了存量 clippy 告警】—— 无 .github/workflows、无 husky/lefthook，.git/hooks 仅 sample；唯一拦截点是 deploy.sh:289-293 构建时 typecheck 失败可人工答 y 放行（非交互 EOF 下 read 在 set -e 中静默中止）。cargo test/clippy/pnpm check/test 全靠提交者自觉。最低成本：GitHub Actions 跑 make sqlx-prepare 校验 + cargo test/clippy + pnpm check/test
- **E2【中】tsconfig 与 vite alias 漂移**【已修复 260822：vite 补 @components/ 前缀映射】—— web/tsconfig.json paths 同时定义 `@components`（精确）与 `@components/*`，而 vite.config.ts alias 只有精确 `@components`：TS 放行的 `@components/xxx` 子路径导入会在 vite 构建期解析失败。修复：vite 补 `@components/` 映射或删 tsconfig 的通配项
- **E3【低】pnpm run compress 指向不存在的文件**【已修复 260822：死引用移除】—— web/package.json:9 引用 scripts/compress-dist.mjs，实际不存在，执行必 ENOENT（部署链未用它，属死脚本引用）
- **E4【低】UI 工具硬编码本机 Chrome 路径**【已修复 260822：三脚本统一扫描缓存取最新 chromium，CHROME_PATH 可覆盖】—— ui-inspect.mjs:56-58、ui-audit.mjs:45-47 钉死 /home/kly/.cache/ms-playwright/chromium-1228/...，换机器/chromium 升级即失效（有 CHROME_PATH 逃生口；ui-check.mjs 的 $HOME 写法是更好范式）
- **E5【低】版本 pin 策略混用**【评估后暂缓：lockfile 已入库兜底实际风险低，统一策略属偏好问题，建议随下次依赖升级一并收敛】—— vite 精确 8.2.1 / typescript ~6.0.3 / 其余全 ^；biome.json schema 钉 2.5.7 而依赖 ^2.5.7 可漂移出 schema。lockfile 已入库兜底，实际风险低
- **E6【低】HSTS 缺 includeSubDomains/preload**【已修复 260822：includeSubDomains 已加；preload 为不可逆提交留待裁定】—— Caddyfile:8 max-age=31536000 仅此而已；单域名部署影响有限，加固一行的事
- **E7【低】Markdown 协商对动态路由返回 404**【已修复 260822：file 匹配器分流，缺失回落 SPA】—— Caddyfile @md-page 把 /card/123 重写为 _md/card/123.md 不存在时直接 404（handle 块互斥不落回 SPA），Agent 以 text/markdown 抓详情页拿不到内容也无回退
- **E8【低】graceful shutdown 强退伪装成成功码**【已修复 260822：exit(1)】—— main.rs:161-165 超时看门狗 std::process::exit(0)，systemd 视为成功退出，不利失败检测；建议非零码

## 六、文档漂移

- **X1【高】doc/modules.md:3 认证边界断言失真**【已修复 260822：列出公开端点清单，text 已随 B1 移入认证组】 —— 「除登录/注册外默认需要认证」不实：公开组还有 /text 全部路由（匿名可写，见 B1）、/media 公开文件、/bookmarks/favicon。应如实列出公开端点清单（并与 B1 一并决策 text 归属）
- **X2【中】doc/database.md:30 迁移版本过期**【已修复 260822：版本描述更新至 v12 并列各迁移内容】—— 文档写「v2..=v6 为增量迁移」，实际 LATEST_USER_VERSION=12（db/mod.rs:627），apply_migration 注册 v2..=v12 共 11 个；领域表还漏列 v12 新增的 5 张 FTS5 虚拟表与触发器。改为「v2..=LATEST_USER_VERSION（当前 12）」并补 FTS 行
- **X3【中】doc/README.md 导航缺近半文档**【已修复 260822：模块与专项设计文档成表】—— 导航表仅 7 篇+散文提及 8 篇；architecture-debt.md、anki-fsrs-scheduling.md、entity.md、life.md、record-design.md、sum.md、frontend-migration-manual.md、enhance.jsonl 及 ux/ 子目录 11 篇均未收录。本次审计报告亦需入表
- **X4【中】architecture-debt.md P1-4 已过时**【已修复 260822：CORS 项核实销账、AI 限速项标注已上线】—— 债务报告称「main.rs 未配置 CORS 时 CorsLayer::permissive()」，但 main.rs:124-148 实际已是「空配置不加 CORS 层（默认拒绝跨域）」并有注释说明——代码已修，债务条目未销账。P1-3 的「AI 端点无限速」同样已过时（rate_limit_ai 已存在）。建议按现状勾销对应 P5 checkbox
- **X5【低】doc/modules.md:8 auth 行定位错误**【已修复 260822：标注组合层归属】—— 表中列为业务模块；实际无 modules/auth，三个 API Key handler 在组合层 app/http/auth.rs。其余 17 模块行与前缀逐一核对无误
- **X6【低】doc/frontend.md 组件表缺 Tooltip**【已修复 260822：已补列】—— atoms/Tooltip.tsx 已存在但组件表未列

## 七、测试盲区

- **T1【高】app 层安全组件零测试**【部分修复 260822：rate_limit 3 用例（XFF 过滤/键提取/配额）；context.rs 与路由装配仍无测试→P2】—— rate_limit.rs（XFF 解析防伪造、锁中毒恢复）、context.rs（371 行）、app/auth/service+repository（API Key 删除权限边界）、routes/api.rs 公开/认证/管理员三组装配全部无测试。限速绕过或 key 权限回归不会被发现。http/auth.rs 本身有 18 个测试标记（良好）
- **T2【高】前端网络层关键分支未测**【大部分修复 260822：新增 request.guards.test.ts 8 用例盖 buildHeaders 矩阵/401 弹窗去重/SSE 跨 chunk 断行；204 空响应体分支待补→P2】—— request.test.ts 13 例只盖 extractErrorBody；request() 非 2xx→全局副作用链（401 弹窗 3s 去重/403 toast）、204 与空响应体、buildHeaders（Bearer 与 X-API-Key 互斥、FormData 不设 Content-Type）未测；streaming.ts 跨 chunk 断行与 data: 无空格分支只有间接覆盖（现有测试只喂完整行）
- **T3【中】后端 admin/ai/text 弱测**【大部分修复 260822：admin 补注册开关持久化/JWT 轮换与重启恢复 3 例；ai 补 SSE 注释心跳/多行 data 2 例——非流式重试分支需注入式 transport，留待后续重构】—— admin 323 行仅 1 例（JWT 轮换/注册开关无人守护）、ai 556 行仅 3 例（SSE 解析与非流式重试几乎未测）；handler 层仅 card/db_viewer 有直接测试。17 业务模块全有测试（底子好），优先补 ai/service 重试分支与 admin/service
- **T4【中】前端 20 个页面模块 16 个零测试**【部分修复 260822：Modal 焦点管理 5 例回归（F6 行为守护）；conv/card/reading 页面装配为主、纯函数极少，剩余建议随功能迭代按需补】—— 仅 bookmark/chat/mem/task 有（modules/ 下 9 个测试文件）；共享 UI 仅 Markdown/confirmStore/toastStore 有，Button/Modal/AsyncView 无。按项目惯例先补 conv/card/reading 的 lib 层纯函数
- **T5【中】E2E 为零**【评估后暂缓：最低成本方案已记录——用 vendored playwright-core 加登录+SSE 冒烟，但需本地起服验证，超出静态修复批次；ui-check/ui-audit 脚本已覆盖部分 headless 冒烟职能】—— 无 playwright/cypress 配置或 spec；web/scripts/vendor/playwright-core 是 ui-inspect 内嵌驱动而非测试资产，.playwright-mcp/（2.3MB）是 MCP 会话产物。SSE 流式端到端、登录态流转全靠手工 curl。最低成本可用 vendored playwright-core 加登录+SSE 冒烟

## 八、查证无问题的方向（负面结果同样有信息量）

- SQLite 迁移事务性成立：单版本单事务，PRAGMA user_version 随事务回滚（db/mod.rs:654-677）
- media 上传路径安全：stored_id 服务端 nanoid 生成、original_name 不进路径、magic bytes+声明双重校验严格、nanoid 天然防覆盖；存量 SVG 有 octet-stream+attachment 缓解
- LIKE 注入防护闭环：60+ 调用点全部经 like_contains/escape_like 且 SQL 端带 ESCAPE '\'（逐一核对）；FTS MATCH 暂无用户输入路径
- import_html 逐行解析器均为安全切片，畸形 HTML 最坏丢条目无 panic
- ServeDir 默认无目录列表；前端 SSE 半行缓冲正确（streaming.ts:59-61）；登录弹窗并发 401 有 3s 去重+幂等守卫；document.title 无泄漏路径；抽查的事件监听/定时器 onCleanup 纪律良好、乐观更新回滚齐全
- TS 严格度近满分：strict:true、全 src 0 处 any/as any/ts-ignore，as unknown as 仅 3 处且在序列化边界
- 五份核心文档（deployment/backend/frontend/architecture/testing）抽查约 20 个断言基本全准

## 九、修复优先级建议

| 优先级 | 条目 | 一句话理由 |
|---|---|---|
| P0 立即 | D1 D2 D3 | 回滚丢数据/WAL 恢复损坏/deploy-web 静默失败——都是下次运维操作就会踩中的雷 |
| P0 立即 | B1 X1 | 匿名可清空笔记是公网暴露面；文档同步改 |
| P0 立即 | R1 R2 | .gitignore 两行改动即修，env 模板与 doc 入库收益立现 |
| P1 短期 | B2 B3 F1 F2 | OOM DoS、导入 XSS、SSE 两处资源泄漏 |
| P1 短期 | T1 T2 E1 | 安全组件零测试+无 CI，回归无网兜底 |
| P1 短期 | D6 D7 | 配置断裂与密钥落盘属一次性修正 |
| P2 规划 | B4 B5 B6 F3-F7 其余中低项 | 正确性/健壮性改进，随相关模块迭代顺路处理；B6 一行 PRAGMA 建议提前 |

> 维护约定：修复某条后请在本文件对应条目尾注「已修复（日期/提交）」，与 architecture-debt.md 的勾选风格保持一致。
