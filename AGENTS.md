# AGENTS.md — BRainbow 项目工作守则

## 硬约束（用户偏好，必须遵守）

- **禁止擅自 git commit / push**：除非用户明确要求
- **禁止擅自部署/远端操作**：`just deploy` / `deploy-web` / `db-push` / `rollback` 必须用户明确许可
- **禁止自写外部测试脚本**：不得为验证目的在仓库外创建临时脚本；用项目已有测试体系
- **禁止用脚本编辑文件（含批量替换）**：`perl -pi` / `python` / `sed -i` / `awk` / `truncate` / `echo >` 之类的"就地改文件"一律不许用 —— **改文件只能用编辑器工具（Edit / Write）**，一处一处改。项目自带的格式化/lint 工具（`cargo fmt`、`cargo clippy --fix`、`pnpm run lint`）属于例外，它们本来就是项目工作流的一部分
- **逐步提交**：用户偏好小步改动、每阶段验证（不强制，但尽量）

## 项目概览

- BRainbow：个人知识管理工具集（任务/卡片/间隔重复记忆 FSRS/本体·符号/AI 对话/英语阅读/书签/通用文件服务/文本）
- 后端：Rust 2024 edition + axum 0.8 + sqlx(SQLite) + tower-http，端口 3000（dev）
- 前端：SolidJS + @solidjs/router + Vite+（Vite 8 / Rolldown / Vitest 5 / Oxlint / Oxfmt）+ stylelint，端口 3001（dev，proxy /api→3000）
- AI 模型：deepseek-v4-flash（推理模型），max_tokens=32768，SSE 流式（eventsource-stream 解析）
- 部署：ssh 通道传产物（进程内 tar.gz 灌进 ssh 的 stdin，本机不需要 rsync/scp/sftp）+ systemd + Caddy（托管前端 dist + 反代 /api，Cloudflare 前置，域名 brainbow.top）；工具链是 `justfile`（入口）+ `xtask/`（Rust 实现，跨平台可测），模板在 `deploy/`（brainbow.service / Caddyfile / ffmpeg.lock）。`Makefile` 与 `deploy/deploy.sh`、`deploy/fetch-ffmpeg.sh` 都已移除：命令全在 justfile（`just --list`）
- **远端布局**（`/opt/brb/`）：`service/` 只放运行文件（`brainbow` + `dist/` + `bin/ffmpeg`，随时可整体替换）；`data/` 放数据（`brainbow.db` + `uploads/{file,favicons}`）；`backup/` 放备份；`tmp/` 是部署暂存（空着是正常态）。这条边界靠 `UPLOAD_DIR` 维持 —— **别让它退回相对的 `uploads`**（那会落进 `service/`）
- **路径走三层级联**：单项显式配置 > 根目录约定（`{根}/data/<DATABASE_FILE>`、`{根}/data/uploads`）> 开发默认。部署时只写根（`REMOTE_BASE`+`APP_NAME`）；应用侧同一个根叫 `BRAINBOW_ROOT`（给手动跑命令用）。**部署配置只读 `.env.prod`，不读进程环境** —— `cargo xtask` 是 `cargo run`，`.cargo/config.toml` 的 `[env]` 会把 `DATABASE_URL` 注进来，读环境会让开发机的构建配置悄悄改掉部署配置（真实踩过）。根目录只在**一处**算（`xtask::Config::from_vars` 的 `data_dir`），应用侧的派生写死在 `src/shared/config.rs`，两边要同步改
- **深入细节先查 `doc/`**，入口 `doc/README.md`（按读者意图分四类：`guides/` 现行操作、`design/` 域设计、`plans/` 冻结快照、`notes/` 随记；每篇带生命周期状态，**只有“现行”可当实现依据**，提案/草稿/调研/已取代见 `doc/design/README.md`）。高频：`guides/architecture.md`（分层契约）、`guides/backend.md`、`guides/frontend.md`、`guides/component-design.md`（组件判据）、`guides/error-handling.md`、`guides/database.md`（表结构/迁移/sqlx offline）、`guides/deployment.md`、`guides/testing.md`（提交前清单）、`guides/modules.md`（模块 × API 前缀对照表）、`design/file-service.md`（文件服务：可见性/白名单/去重）、`guides/design-tokens.md` 及各业务域设计文档。**发现 `guides/` 与实现不一致时以代码为准改文档；`plans/` 是时间快照，不要动**

## 关键命令

```bash
# 任务入口是 justfile（逻辑在 xtask/，Rust）；`make` 只剩本地开发目标
just dev              # 开发：cargo-watch + vite 并行（自动加载 .env.dev）
just build            # 前端 typecheck+vite 与后端 release 并行，组装 build/
just deploy           # 全量部署（需用户许可）；先看流程用 `just deploy --dry-run`
just check            # 部署前环境检查：SSH / 免密 sudo 白名单 / Caddy / 本地产物 / libc 兼容
just health|status|info|logs|list-backups
just caddy            # 仅同步 Caddy 配置并重载（不停服）—— 改 deploy/Caddyfile 后用这个
just deploy-web       # 仅前端（不停服、不动 unit）
just rollback [时间戳] [--yes] | db-pull | db-push | db-backup | db-check | db-optimize | backup-prune
just render unit|caddy # 打印渲染结果（可与现网逐字节 diff）
just fmt|lint|test|test-web|sqlx-prepare|fetch-ffmpeg

# 本地快速验证：
just dev-backend-fast # 快速编译验证后端（cargo-watch -x check，不启动服务，适合多窗口开发）
just check-backend    # 后端只读自检（DB schema/完整性 + 上传目录 + 存储一致性；退出码非零=有问题）
just stats            # 产物与缓存目录的体积一览（clean / clean-cache / udeps / bloat 同在此）

# web 目录（pnpm）：
pnpm run dev          # vp dev --mode dev（读根目录 .env.dev）
pnpm run build        # vp build --mode prod（读根目录 .env.prod）
pnpm run check        # vp check + stylelint（format/lint/typecheck 一键全量）
pnpm run lint         # vp lint --fix + stylelint --fix
pnpm run test         # vp test run（Vitest 5；test:watch 常驻）
pnpm run typecheck    # vp check --no-fmt --no-lint（只做类型检查）

# 后端：
cargo test                        # 全部测试（可 cargo test modules::<name> 单模块）
cargo clippy --workspace --all-targets  # lint 门禁（含 xtask），提交前必过
```

**改动后必须跑**：web 改动 `pnpm run check && pnpm run test`；Rust 改动 `cargo test && cargo clippy --workspace --all-targets`；SQL/schema 改动追加 `just sqlx-prepare`。

## Windows 开发（2026-10-04 实机跑通）

上面那套命令在 Windows（Git Bash + MSVC 工具链）上**全部可用**，不需要 WSL：`cargo test` 863 通过、`just lint` / `just test-web` / `just check-backend`（自检 6 项全过）/ `pnpm run check` / `pnpm run test`（200 文件 1631 用例）/ `pnpm run build` 都是绿的；`cargo run` + `pnpm run dev` 起来后 `http://localhost:3001/api/health` 返回 `{"database":"ok","status":"ok"}`。只有"部署"那一类（`deploy` / `db-push` / `rollback` / `check`）与 `fetch-ffmpeg` 是 Linux 专属，Windows 上不要跑。

四条踩过的坑，按"会不会再踩"排序：

1. **环境变量 `CC` 不能指向 MinGW 的 gcc**（最容易踩、报错最看不懂）。装了 MinGW 的机器常有全局 `CC=gcc`，cc-rs 会拿它去编 libsqlite3-sys 的 SQLite amalgamation，产出按 MinGW 约定命名的目标文件，MSVC 链接时缺 `___chkstk_ms` / `__isnan` 而报 LNK2019 —— 这两个符号在 VC 与 SDK 里都不存在，顺着名字查找不到根因。**修法是删掉 `CC`**（或确认 `CC_x86_64_pc_windows_msvc` / `HOST_CC` 也是空的），让 cc-rs 自己定位 MSVC；不需要开 vcvars。cc-rs 那句 `GNU compiler is not supported for this target` 是唯一的线索，别当噪音。完整说明与"为什么不用 `[env]` 写死"在 `.cargo/config.toml` 尾部。
2. **换行符**：仓库现在有 `.gitattributes`（`* text=auto eol=lf`）。在这条规则之前，Windows 上 `core.autocrlf=true` 会把工作区检出成 CRLF，`pnpm run check` 于是对**每个**前端文件报格式错误（实测 103 处），看着像整仓库没格式化。老检出（在加 `.gitattributes` 之前 clone 的）要重新物化一次才会变 LF：`git add -A && git checkout-index -a -f && git reset -q`（`git status` 会拿 stat 缓存"骗"你，用 `git ls-files --eol | awk '$2!="w/lf"'` 才看得准）。
3. **Node 版本**：`.nvmrc` 钉 24（`scoop reset nodejs-lts` 可切，实测 24.21.0 全绿）。Node ≥ 26 也能跑 —— 它默认在 globalThis 上定义 `localStorage`，没给 `--localstorage-file` 时值是 `undefined` 且**盖住** jsdom 那份，一度让 5 个文件 63 个用例在 `beforeEach` 里报 "Cannot read properties of undefined"；`web/vitest.setup.ts` 已补回一个最小实现，两个版本都验证过。
4. **Windows 的文件锁**：运行中的 exe 不能被覆盖。`just dev` 会一直占着 `target\debug\xtask.exe`，此时另开一个 `just <命令>` 若需要重新链接 xtask 就报 `拒绝访问 (os error 5)` —— 停掉 dev 再跑，或直接用 `cargo` / `pnpm` 那条底层命令。同理，杀进程时子进程不会被带走（`cargo run` 死了 `brainbow.exe` 还占着 3000 端口），要按名字补一刀。

另两条只是"知道就行"：vite dev server 在 Windows 上只绑 `[::1]`（`localhost` 优先解析到 IPv6），浏览器访问 `http://localhost:3001` 正常，但用 `curl 127.0.0.1:3001` 会连不上；`/admin` 的服务器信息里内存/负载/磁盘读的都是 Linux 的东西，Windows 上按既有约定显示"—"。

## 架构契约

### 后端（src/）

依赖方向（单向）：`modules → brainbow-db + shared`；`brainbow-db → sqlx`；`shared` 不依赖业务模块；`app` 是组合层（路由装配/认证/限速），负责把各模块组装起来。**业务域之间禁止互相 use 对方实现**，跨域依赖经 port trait 接缝（async_trait，如 ai/port.rs 的 AiChatPort、mem/port.rs 的 MemRepository、admin/port.rs）或 app 层协调。

- **模块分层**（`modules/<域>/`）：`mod.rs`(路由定义) → `handler.rs`(HTTP 转换与校验) → `service.rs`(写侧业务规则) / `query.rs`(只读查询聚合) → `repository.rs`(sqlx 数据访问)，DTO/领域模型在 `model.rs`。单文件过大再拆子目录（范例：task 的 repository/handler 各拆多文件）。典型链路：HTTP → handler → service/query → repository → SQLite
- **DB 基础设施 crate**：连接/PRAGMA、schema 声明、迁移、自检在 `crates/db/`（`brainbow-db`）；应用里的 `src/db/mod.rs` 只是 facade（`pub use brainbow_db::{connect, migrate, verify}`）。**repository 仍留在各模块**，不要把业务查询塞进 db crate——那会让 db 依赖所有领域模型，变成 god crate
- **模块清单**：user、task、calendar、card、onto、sign（能指-所指）、text、file（通用文件服务）、mem（FSRS 记忆）、reading、bookmark、conv（对话历史）、chat（AI 对话树）、ai（AI 设置/代理调用）、search（全局搜索）、admin、db_viewer（**无 feature gate**：随产物编译，路由只挂在管理员组；Cargo.toml 没有 `[features]`）。API 前缀对照表见 `doc/guides/modules.md`
- **任务时间与日程**：`task` 内含 `task_block`（feasible/planned）与 `task_series`（循环任务）；`calendar` 持有 `calendar_event` / `calendar_event_series`（生日/纪念日/节日，公历/农历/清明）。**Todo 是 task 的投影，Calendar 是 task_block + calendar_event 的投影**。旧的 `time_window` 模块/表已删除（v26 迁移到 `task_block`，`actual` 丢弃）。
- **shared 工具箱**：pagination（page_size≤100 自动 clamp）、db_query（push_opt 条件拼接、LIKE 转义；`sanitize_table_name` 已归 `brainbow-db`）、batch（batch_execute 逐项执行 + guard_empty_batch! 空批次宏）、search（全局搜索 SearchPort/SearchHit，各模块实现端口聚合）、time_text（统一 "%Y-%m-%dT%H:%M:%S+00:00"，不用 Z 是为对齐 sqlx DateTime 文本编码）
- **生产代码 lint 门禁**（main.rs 顶部 `#![cfg_attr(not(test), deny(...))]`）：非测试代码禁止 unwrap/expect/panic!/越界索引/dbg!/todo!/unimplemented!/println!/eprintln!（日志统一走 tracing）/float_cmp；**测试代码豁免可直接 unwrap**。这套门禁只作用于应用本体 —— `xtask/` 是独立 crate（CLI 往 stdout 打进度是本职），不继承，这是刻意的
- Cargo.toml `[lints.clippy]`：一组自动修复类 warn（uninlined_format_args 等，`cargo clippy --fix` 可修完）；cast 类有意 allow（FSRS 数学/分页）
- **错误处理**：service 层返回 shared/error_types.rs 的 ServiceError（InvalidInput→400 / NotFound→404 / AlreadyExists·InUse→409 / Internal·Db→500），带机器可读错误码（INVALID_INPUT/NOT_FOUND/RESOURCE_IN_USE…）供前端分支；统一错误体为 {code, message, details?}。成功响应复用 shared/response.rs 快捷构造（ok()/message()/id()），勿在各模块重复定义同形响应。**框架自己的拒绝也归一到同一形**：`app/http/rejection.rs`（与 panic 层同级、只对 /api 生效）把 axum 提取器回的那几段 text/plain 英文原文（畸形 JSON、`missing field`、缺 Content-Type、413、405）改写成 {code, message}，原文进 tracing 日志 —— 那几段是未认证就能触发的，别让它们直接回给客户端
- **AI/SSE 流式约定**：ai/service.rs 经 eventsource-stream 解析上游 SSE（流式不重试，非流式重试 2 次；超时分治——上游客户端统一 5s 建连超时，非流式另加 180s 总超时使重试可触发，流式不带总超时）；reasoning 单独推送带前缀 __R__:；chat 模块向前端推流以 __DONE__ 结束、错误前缀 __ERROR__:，失败回滚已插入节点——前后端标记需保持一致
- **认证**：密码 bcrypt 哈希；用户名密码 → JWT（HS256，TTL 默认 864000s=10 天），同时支持 API Key（`X-API-Key` 头，明文仅创建时返回一次，库存 SHA-256）；**首个注册用户自动成为 admin**；管理员接口过 require_admin 中间件；**认证边界是唯一把凭据翻成 `Actor` 的地方**（`app/http/auth.rs` 的 `auth` 中间件与 `optional_actor`，后者给公开路由"带凭据多看点"用；两条凭据路径都产 `Actor`，handler 一律 `Extension(actor): Extension<Actor>`，别再要求 `Claims`）；`api_key.user_id IS NULL` 的"无主 key"在认证时直接拒绝（401 + WARN）—— v20 之后它看不到任何数据。**已知取舍**：API key 的 role 是建 key 时固化的字符串，把某个 admin 降级成 user 后他手里的旧 key 仍是 admin（要么校验时回查当前角色，要么角色变更时吊销该用户的 key）。限速为内存固定窗口：登录/注册每 IP 60s×10 次、/ai 独立桶 20 次/分钟，超限 429 code="RATE_LIMITED"；**限速键优先 `CF-Connecting-IP`；取不到时退到 `X-Forwarded-For` 的最后一个合法 IP（最靠近本进程的一跳），最后才是直连 peer** —— 绝不取 XFF 首值：CF 对 XFF 是追加语义（客户端自填的值留在最前），按首值取键等于把键交给请求方；而 Caddy ≥2.7 又会把不可信 XFF 整个换成它的对端地址（= CF 边缘 IP，所有访客挤一个桶），所以只在没有 CF 头时用作退路
- **配置**：src/shared/config.rs 集中读环境变量且都有默认值；关键变量：DATABASE_URL、SERVICE_PORT、BIND_HOST、CORS_ALLOW_ORIGIN、ALLOW_REGISTER（运行时可被 admin 写 DB 覆盖）、JWT_TTL_SECS。注意 JWT_SECRET 缺省随机生成（重启即失效），且**实际生效密钥以 DB app_settings 为准优先于 env**，admin 接口可轮换并立即作废旧 token
- **启动自检**（app/self_check.rs，启动跑浅检查、`brainbow --check` 跑深检查）：① schema 漂移（表与列都对照**声明** —— `db::verify::required_tables()` 从声明派生，列比对在内存库里照声明建一遍再读 xpragma；缺表/缺列致命，声明之外的列只报 + `foreign_key_check`）② `PRAGMA quick_check`（178MB 库数秒，**只在 --check 跑**，不进启动路径）③ 上传目录可写性 ④ 存储一致性（缺失/孤儿/大小不符/分类不符）⑤ 缩略图缓存。①②③ 致命则中止启动，④⑤ 只告警。`--check` 全程只读（不迁移/不建目录/不删文件），退出码 0 = 干净；`just deploy` 在服务就绪后自动跑一次。**漏抬 `SCHEMA_VERSION` 由 ① 兜底**（声明改了、版本没动 → 老库不补齐 → 启动就报"缺失列"）
- **文件服务可见性模型**（`doc/design/file-service.md`）：文件**默认公开**，可单独设私密（`file.is_private`）；公开文件的内容路由**无需凭据**（Markdown 的 `<img src>` 不带 Authorization），私密文件要求 JWT/API Key 且为上传者（未认证 401 / 越权 404）；改名与删除仅上传者或 admin（越权按"不存在"回 404）。**"匿名老文件视为公共资源"这条已作废**：v20 把 `user_id IS NULL` 的历史行认领给了当前 admin，无主行现在只有 admin 看得见、改得动。标签全局共享。可见性规则集中在三处，改一处要同步其余：`repository::push_visibility`（SQL）、`query::is_visible`（详情/搜索）、`query::content_access`（内容路由三态）
- **授权与归属**（`doc/design/authorization.md`）：两档角色 —— **admin 全管；普通用户只管自己创建的**。判据唯一一处：`shared/actor.rs` 的 `Actor`（字段私有 + 只读访问器；生产代码里只能由认证边界 `From<&Claims>` 造出来，`Actor::user/admin` 仅 `#[cfg(test)]`）。SQL 侧统一写法 `(?N IS NULL OR 归属列 = ?N)` 绑 `owner_scope()`（QueryBuilder 用 `push_owner_scope`），admin 绑 NULL 即不过滤；子表随父（读用 `EXISTS` 连父表，写在 service 层判父行归属）；越权一律按"不存在"（404）。前端按响应里的 `can_edit` 隐藏非 owner 的写入口，界面不显示"谁创建的"

### 数据库与 SQL（高频出错区）

- **schema 只有一份声明**（`crates/db/src/schema/`）：`tables.rs` 表与索引、`time.rs` 时间列、`fts.rs` 全文索引、`legacy.rs` 废弃对象、`repairs.rs` 版本化幂等修复。三个消费者共用它 —— 新库 `create_tables` 直建（`user_version = 0` 且一张表都没有）、老库 `apply::reconcile` **按形状**补齐、自检只读比对。生产启动与所有测试共用同一份声明（防漂移）；库版本（`schema::SCHEMA_VERSION`）高于代码已知版本直接启动失败。**模块内禁止自行 CREATE TABLE**
- **改 schema = 改声明 + `SCHEMA_VERSION += 1`**（就这两步）：删表/列/索引登记进 `legacy.rs`，要动存量数据（搬值/回填/合并）加一条**幂等**修复。不再有"基线 + 迁移链"两份书写，也没有 mod/match/LATEST/ADDED_COLUMNS 那几处登记 —— 老库补列的**列定义取自声明文本本身**（把声明 DDL 换个临时表名建一次、读 `pragma_table_xinfo` 拿定义，让 SQLite 自己解析），所以"迁移写 `DEFAULT 0`、基线写 `DEFAULT 7`"这类漂移结构性不可能。注意 **`pragma_table_xinfo` 而非 `table_info`**（后者不列 VIRTUAL 生成列），以及**已发布条目的 DDL 文本别改写**（老库的列是照它逐字追加的）
- **reconcile 的阶段顺序就是规则本身**：① 废弃表/索引 → ② 表与列 → ③ 数据修复 → ④ 索引 → ⑤ 时间触发器 → ⑥ FTS → ⑦ 删声明之外的列。两条历史教训编码在次序里：数据修复必须早于唯一索引（v17 先去重）、时间触发器必须早于 FTS 触发器（AFTER 触发器按创建顺序触发，而时间归一化的 UPDATE 会连带触发 FTS 的 `_au`，反了会撞出 `database disk image is malformed`）。**FTS 触发器每次重铺**：老库上它们早就在，只补时间触发器就会反序（实测踩到）
- **「升级 ≡ 新建」**（`db::tests::upgrade_path_reproduces_column_definitions` + `reconcile_restores_pre_v18_shape_to_fresh_equivalent` 钉住）：把声明里的列删掉（SQLite 拒绝删的主键/被引用列自动跳过）→ reconcile → 与新建库逐列比对类型/NOT NULL/默认值/生成列 + 对象清单。清单是**推导**的（声明里的表），没有人工登记，也就没有"漏登记 = 漏验"的洞（旧实现靠 `ADDED_COLUMNS` 手抄，漏登记是静默的）
- **时间戳列必须进 `time::TIME_COLUMNS`**（`db::tests::time_columns_cover_every_timestamp_column` 钉住：库里每个 TIMESTAMP 列都要在清单里、且 `trg_<表>_time_iso_{ins,upd}` 真的建出来）。为什么较真：老库的**列默认值改不掉**（SQLite 不能改列定义），历史上基线写过 `CURRENT_TIMESTAMP`（空格分隔、无时区）/ `…Z` / `…+00:00` 三种，老库与新库的默认值天然不同 —— 这无害**当且仅当**写入会被触发器改写成规范格式；漏进清单的列会把默认值格式原样落库（`file.updated_at` 就这么漏了 11 行）。**写 `updated_at` 别再写 `= CURRENT_TIMESTAMP`**，用 `strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')` 或 `time_text::utc_now_iso()`
- `--check` 的第 6 项是**时间戳格式扫描**（`db::verify::check_timestamp_formats`）：扫所有 TIMESTAMP 列、报出非 `+00:00` 形态的行数（34 列在 178MB 库上约 30ms，但随行数线性变慢）—— 与 quick_check 一样只在 `--check` 跑，启动日志照实打"未检查"。不致命（重启修不了数据）但进 `is_clean`，所以它是 `--check` 退出码的依据，部署收尾那次自检会报出来（部署侧只告警不回滚）
- **reconcile 只做加列与删列**：改类型/改默认值/加约束/改名都要重建表，项目至今没用到过 —— 真要做时写一条显式修复，并记住两个坑：`PRAGMA foreign_keys` 在事务内是 no-op；`DROP TABLE` 开着外键会把子表行级联删掉。（顺带：`ALTER TABLE ADD COLUMN ... GENERATED ALWAYS AS (...) VIRTUAL` 可用且能建索引 —— v19 的 `file.category` 即此法；生成列表达式在声明里要登记一份（`Decl::generated`），有测试盯着两份一致）
- 补齐/修复失败必须上抛导致启动失败，**禁止静默吞错**
- **schema 改动要拿真库副本演练**（配方在 `doc/guides/database.md`）：`cp brainbow.db target/rehearsal.db` → `BRAINBOW_FIXTURE_DB=<副本> cargo test migrate_fixture_db -- --ignored`，前后 dump 列定义/对象清单/逐表行数对照 —— 内存库的合成形状证明不了真库能升上来。顺带记：**SQLite 的 `-wal` 陷阱** —— 换库文件前不连 `-wal`/`-shm` 一起删，陈旧 WAL 会被拼进新库（`cp` 出来的库 salt 相同，SQLite 的校验拦不住；实测拿到过一个"迁移完成 0.01s"的假象）
- **静态 SQL 一律用 sqlx 编译期宏**（query!/query_as!/query_scalar!），离线快照提交在 `.sqlx/`；动态 SQL 用 QueryBuilder 且保持测试覆盖。**任何 SQL 变更后必须 `just sqlx-prepare` 并把 .sqlx 变更一起提交**，否则离线编译失败
- **本地编译是在线校验**（`.cargo/config.toml` 设了 `SQLX_OFFLINE=false` + `DATABASE_URL=sqlite:brainbow.db`），所以 schema 变更的正确顺序是：**先让库迁移 → 再写引用新列的 SQL → 再 just sqlx-prepare**。反过来会卡死（新 SQL 编译不过 → 无法跑迁移 → 库还是旧 schema）；应急可用 `SQLX_OFFLINE=true` 走离线快照编译。注意 **release 构建走的是另一条路**：`just build` 显式设 `SQLX_OFFLINE=true` 且摘掉 `DATABASE_URL`（只 `env -u` 没用，`[env]` 会注回去）
- SQLite pool busy_timeout 3s；删除逻辑依赖外键级联时先确认 PRAGMA foreign_keys 行为

### 前端（web/src/）

- **路径单一来源**：`config/paths.ts`（PATHS 常量，父子路径拼接派生，fillPath() 替换 :id）→ `config/navigation.ts`（NAV_ITEMS 元数据 `path` / `label` / `title` / `desc` / `nav`）→ `app/routes.ts`（PAGE_LOADERS 派生路由）。PAGE_LOADERS 类型是 `Record<PathValue, PageLoader>`，**漏加 loader 直接编译失败**。调用点一律 `PATHS.xxx`，禁止硬编码路径字符串
- **应用外壳（左侧导航 + 顶栏 + 状态条）没合进 main**：main 上仍是"内容占满、Layout 只管认证/错误边界"的原结构。带 `AppShell.tsx` / `AccountMenu.tsx` 的探索在 **`design/swiss` 分支**（未合入），不是 `design/kumo-skin`——后者与提交 `627b19da` 在本仓不存在。看外观先读 `doc/design/swiss-design-language.md`；kumo 研究的结论只在 `doc/design/kumo-design-language.md`，不要再按"main 已有 kumo-skin"写代码
- **Kumo 组件曾收编、已移除**：`web/src/components/kumo/` 由 31ffdb3d 收编，7c0b8d54（2026-10-18）从 main 删除；当前 main 没有这个目录，也没有 `@photon-ai/base-ui-solid` / `cnfast` 依赖。`doc/design/kumo-design-language.md` 只保留设计语言研究，别再按"main 已有 Kumo"写代码或文档
- **模块物理分层**：`domains/<域>`（业务域）、`capabilities/<能力>`（跨域组合）、`platform/<平台>`（认证/设置/文件服务等）、`tools/<工具>`；模块页面在各自根，内部统一 `model/`（纯规则）、`view/`（页面状态）、`data/`（多文件数据适配）、`components/`；跨模块只通过 `index.ts` 导出交互
- **分层**：app（入口/Layout/路由/ambient）；capabilities → domains → platform → shared；components 是共享 UI，不得反向依赖模块；config 是零依赖旁路
- alias：`@app` `@domains` `@capabilities` `@platform` `@tools` `@components` `@shared` `@config`；`@modules/<name>` 是**兼容别名**（由 `config/module-registry.ts` 映射到对应物理层），新代码优先用层别名或模块公共入口
- **样式**：CSS Modules 为主（camelCaseOnly），全局 CSS 仅 3 个；design tokens 双处——`shared/styles/tokens.css`（--t-* 颜色/字体随主题，oklch，三套实底主题 paper/midnight/ocean + auto 经 :root[data-theme] 切换，auto 跟随系统 prefers-color-scheme）+ `app/global.css`（--radius/--space/--text 布局常量不随主题）；theme.ts 负责 initTheme/applyTheme + 字号档位 fontScales（normal/large/extraLarge 三档，initFontScale/applyFontScale）；**`kumo` 主题（冷灰 · 品牌蓝）、`--t-font-numeric`、`--t-color-action(-strong/-ink)`、`--t-color-nav-*`、Inter Variable 是历史提案，不在 main**；`design/kumo-skin` 分支/提交在本仓不存在，Kumo 组件已在 7c0b8d54 移除；stylelint standard 配置 + `declaration-no-important` 门禁（print/reduced-motion 块级豁免）；tokens.css 含 `@media (forced-colors)` 与 `@media (prefers-contrast: more)` 适配；容器查询 `@container` 用于组件级自适应（详见 global.css 断点分工注释）
- **界面上的解释文字收进 `InfoHint`（`@components/ui`）**：`<InfoHint label="关于备份统计">…说明…</InfoHint>` 会渲染一个 ⓘ 按钮，悬浮或键盘聚焦时用气泡展开（复用 `Tooltip`：Portal + role=tooltip + aria-describedby）。判断标准是**状态留在界面上、解释收进气泡**："备份目录：/opt/brb/backup""JWT 已持久化"这类是状态（要一直看得见），"为什么是 —""怎么配""点了会怎样"这类是解释（要用时才看）。别拿它藏必读信息，也别给每条文字都挂一个 ⓘ
- Markdown 渲染：components/ui/atoms/Markdown.tsx（懒加载壳）→ MarkdownCore.tsx（marked+katex+highlight.js common 36 语言+dompurify，全部懒加载，勿把工具链弄回首屏同步链）
- 401/403 全局处理在 `lib/api/request.ts`（handleGlobalError）：401 静默派发 AUTH_REQUIRED_EVENT 弹 AuthDialog、403 toast 提示；Layout 除 / 外全包 AuthGuard，/ 由 routes/HomeGuard.tsx 分流 LandingPage/HomePage；AuthDialog/CommandPalette/Toast/ConfirmModal/AiSettingsModal 常驻 Layout
- 内存缓存 `lib/api/cache.ts`：只缓存 GET、默认 TTL 30s（部分调用如 getMediaE/getCardE 显式 60s）、上限 200 条淘汰最旧、CACHE 预定义各领域失效正则（invalidateCache/tapInvalidate，写路径必须配对调用）、logout 时 clearAllCache（勿删此逻辑）
- AI 客户端在 `lib/ai/`：统一走后端代理 /api/ai/chat，**api_key 不进浏览器**；SSE 流解析在 `lib/api/streaming.ts`（fetch + TextDecoder 手写逐行解析 data: 前缀，无 eventsource 库），消费方 chat/hooks/streamChatRequest.ts
- **列表写操作走乐观更新**：先改本地（`createResource` 的 `mutate`）、再发请求、**成功不 refetch、失败才 refetch 回滚** + 提示。原因是 `AsyncView` 在 `loading` 时渲染骨架屏，写操作后整表重取会让列表闪一下（file 模块已全部改造：删除/重命名/批量删除/批量加标签/切换可见性；统计类数据仍走后台 refetch，它不闪骨架）

### 配置与环境

- 根目录 `.env.dev`（开发，前后端共用）/ `.env.prod`（生产+部署脚本）；模板 `.env.dev.example` / `.env.prod.example` 已被 .gitignore 白名单放行入库，新环境从模板复制创建
- 前端变量：VITE_PORT（fail-fast 校验非法值）、VITE_API_TARGET、VITE_SITE_URL；vite.config.ts 用 loadEnv(mode, 项目根) 读根目录 env
- debug 构建 main.rs 用 dotenvy 读 `.env.dev`；生产由 systemd 注入（不读文件），unit 模板 deploy/brainbow.service（TimeoutStopSec=15 兼顾 SSE 优雅关闭、MemoryMax=1G、CPUQuota=80%）
- 前端由 **Caddy** 托管（远端 /etc/caddy/Caddyfile，模板 deploy/Caddyfile）：/assets 长缓存 immutable、SPA fallback no-cache、安全头（CSP/HSTS/XFO/COOP）、Accept: text/markdown 协商（dist/_md/*.md）
- SEO/Agent 产物构建时生成（vite seoPlugin 系列，数据源自 NAV_ITEMS + VITE_SITE_URL）：sitemap.xml、robots.txt、llms.txt、_md/、openapi.json、.well-known/api-catalog —— 改 config/paths.ts / navigation.ts 后构建自动重生成，无需手动同步；模板在 web/scripts/seo-assets/，勿手改 dist

### 前端构建产物体积警戒线

- 首屏同步链约 180KB 未压缩；manualChunks 固定拆 markdown-vendor（marked/katex/hljs/dompurify，必须保持懒加载）与 solid-vendor；**three 只能在 3D 模型查看器里 `await import`**（独立懒 chunk，736KB / gzip 187KB），静态引入会把首屏撑爆
- vite 8（rolldown）：build.target 显式 baseline chrome111/edge111/firefox114/safari16.4/ios16.4；CSS minify 用内置 lightningcss（无需 autoprefixer）；生产不开 sourcemap；modulePreload 会预取共享 chunk

## 测试约定

- 前端：Vitest 5（由 Vite+ 提供），环境**按文件分**（配置内嵌 vite.config.ts，无独立 vitest.config）：**`.test.ts` → node、`.test.tsx` → jsdom**；少数需要 DOM 的 `.ts`（hook / 事件 / 剪贴板）在文件头写 `// @vitest-environment jsdom`（**注意 `vite-plugin-solid` 只在配置没写 `environment` 时把默认设成 jsdom**，所以根配置显式写了 `environment: "node"` 夺回控制权）。实测（2026-10-04）：全 jsdom 44.8s → 本配置 25~28s（当时 197 文件 / 1599 用例；文件数会随代码增长），`maxWorkers: 12` 是照本机 16 核 / 7.6GB 定的（默认并发吃不满 CPU，再多会开始换页）。测试文件 `src/**/*.test.ts(x)`；风格为纯函数直测 + solid-js/web render 手写 DOM（无 testing-library）；修改逻辑尽量补测试
- **改动后按需跑**（全量很贵，别每次都全量）：`cargo test modules::file`（单模块 ~15s，全量 ~50s）、`pnpm run test src/platform/file`（~5s，全量 ~28s）。**别把两套全量并行跑**：本机 7.6GB 内存下后端测试与 jsdom 会抢核换页，实测并行 85s > 串行 75s
- 后端：Rust 单元测试写在模块内 `#[cfg(test)]`（可直接 unwrap）；SQL 相关测试用内存 SQLite + `crate::db::migrate`；config.rs 有注入式 vars 测试范式；跨模块隔离测试见 modules/isolation_tests.rs
- 部署后验证：ssh 到远端 curl 验证关键端点（.well-known/api-catalog、sitemap.xml、health）
- 提交前清单（完整版 `doc/guides/testing.md`）：cargo test ✓ cargo clippy --workspace --all-targets ✓ web 改动 check+test ✓ SQL 改动 just sqlx-prepare ✓ 未擅自 push ✓

## 新增功能速查

- **后端新模块**：`src/modules/<name>/` 建五件套 → `src/app/http/routes/api.rs` 挂载路由 → （新表/新列）`crates/db/src/schema/tables.rs` 加声明 + `SCHEMA_VERSION += 1` → `just sqlx-prepare`
- **前端新页面三步**：paths.ts 定义 PATHS → navigation.ts 加 NAV_ITEMS 条目 → routes.ts 加 PAGE_LOADERS loader（懒加载 import）

## 常见坑

- vite.config.ts 里 import src 下的 TS 必须带 `.ts` 扩展名（config loader 限制）
- SSE 链路不能设整体 timeout（AI 思考间隔会断流；vite proxy /api 无 timeout，/uploads 有 5s；后端 ai 模块同规则——仅非流式请求带总超时）
- 时间：后端统一存储 %Y-%m-%dT%H:%M:%S+00:00（shared/time_text.rs，不用 Z 以对齐 sqlx DateTime 文本编码）；前端展示时补 `Z` 解析；chat_tree 有 kind 列（chat/mem）
- 测试账号 qa/qatest123（user_id 14）
- CSP 是 `script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com` + `connect-src 'self' https://cloudflareinsights.com`。三件事要一起记：(1) `'unsafe-inline'` **必需** —— `web/index.html` 的"应用初始化失败兜底"内联脚本 + 内联 style（想去掉得给那段脚本算哈希）；(2) CF Web Analytics 的两条源**必须成对** —— beacon 脚本在 `static.cloudflareinsights.com`，它的 RUM 上报打到 `cloudflareinsights.com/cdn-cgi/rum`（从 beacon 源码核过），只放脚本源会变成"脚本跑起来、上报被 connect-src 挡"；(3) `'unsafe-eval'` 已随 **CF Rocket Loader 关闭**移除（2026-09-25），别再开回来 —— Rocket Loader 会把 `<script type="module">` 改写成 `<script type="<hash>-module">` 并让带 `integrity` 的 beacon 加载失败（SRI 与它冲突）。**动 CSP 前先确认 CF 侧没有会改写 HTML 的功能**（Rocket Loader / Auto Minify 之类），否则会出现"控制台报错但页面看着没事"的假象
- isitagentready.com/api/scan 可验证 SEO/Agent 各项指标（sitemap/markdown 协商/api catalog 均 pass）
- 上传体积上限：文件服务请求体 4GB+64MB（单文件上限按 MIME 白名单分档：视频/白名单外 other 4GB、音频 1GB、文档 500MB、图片 200MB、SVG 20MB）、书签 HTML 导入 64MiB（均 DefaultBodyLimit）。**站点经 Cloudflare 时实际上限是 CF 套餐的请求体上限（Free/Pro 100MB）**，超限边缘层 413，后端放多宽都到不了 —— 传大文件需 DNS-only（灰云）直连源站。前端 `web/src/platform/file/model/uploadLimits.ts` 是这套分档的镜像（上传前预校验空文件/超限），改后端分档必须同步改它，`uploadLimits.test.ts` 会读 service.rs 比对，漏改挂测试
- **文件类型识别是"先定族、再定种"两阶段**（`mime.rs` 的 `detect_family` + `refine_*`，见 `doc/design/file-service.md` §3.1）：族由字节定（zip / RIFF / ISO BMFF / OGG / Matroska / OLE / 单签名 / 文本），种在族内由容器标记 + 扩展名 + 声明定。**"这种类型能干什么"（上限档 / 缩略图 / 预览解析器 / 内联策略 / 正文抽取）只在 `kind.rs` 的 KINDS 表里定义一处**：精确行 → 家族模式（`image/*`）→ 兜底行，`kind_of` 精确优先且永不返回 `None`；`limits` / `thumb` / `content` / `preview` / `extract` 都只查它，别在调用点新写 `matches!`。类别**不在表里**（唯一口径是 `FileCategory::from_mime`，DB 生成列照它）。另一条：**上限只认精确行** —— 家族模式只补能力，不改上限口径（`image/avif` 走的是 other 档 4 GiB）。几条硬约束：① **"是不是文本"由字节判**（`looks_like_text`，与前端 `lib/magic.ts` 的 `looksTextual` 同一判据，两侧同步），**别再引入按扩展名的 MIME 映射表**（`mime_guess` 因此被删：它把 `.ts` 报成 `video/vnd.dlna.mpeg-tts`、`.json` 报成 `application/json`，那批源码文件全被判成二进制进了 hex 查看器）；② **声明只在族内消歧**，两道闸门 —— 声明了白名单里"本有魔数"的类型却验不出对应族 → 拒；内容认不出族却声明 `text/*|pdf|svg` → 归 `octet-stream`；客户端没表态（空 / octet-stream）时以字节为准（浏览器对 `.sqlite`、`.7z` 报空，按声明比对会把它们全拒掉）；③ 类别**只**由 `FileCategory::from_mime` 决定（与 DB 生成列一致，`consistency.rs` 钉住），上限另查白名单分档，别再读白名单的类别列；④ 前端注册表里**按扩展名认领的规则（splat/epub/model/database/archive）必须排在文本规则之前** —— ASCII 的 `.ply`/`.stl`/`.gltf` 内容是文本、mime 就是 `text/plain`，顺序错了会被渲染成一屏纯文本；⑤ zip 族定种分两次：判定在流式落盘**之前**（只有头部 512 字节，读不到中央目录），落盘后 `refine_zip_by_structure` 再按条目名覆盖一次（`word/`→docx、`xl/`→xlsx、`ppt/`→pptx、`AndroidManifest.xml`→apk、`META-INF/MANIFEST.MF`→jar）——**结构 > 声明 > 扩展名**，别把这次覆盖去掉；⑥ **文本族里"是不是 SVG"看根元素，不看"出现过 `<svg`"**（`looks_like_svg`）：判据是跳过 BOM/空白/XML 声明/DOCTYPE/注释后**以 `<svg` 开头**（后随空白、`>`、`/`）。老判据是 `contains("<svg")` 且扫的是**第一个 multipart 块**（几 KB），于是任何带内联 `<svg>` 图标的 HTML（现代网页的常态）都被判成 `image/svg+xml`，连扩展名给的 `text/html` 都被覆盖（真实事故：SingleFile 保存的博客文章存成了 image/svg+xml，缩略图与预览全坏）。同类判断（"这是不是某种文本格式"）一律照这个思路：**看结构/根元素，不看子串出现**
- **类型判定改了之后，旧记录靠"重传一次"跟上**（`service::reconcile_mime`）：上传命中去重（内容 SHA-256 相同）时，按**当前**判定纠正已有记录的 `mime_type`（`update_mime` 不动 `updated_at`；`category` 是生成列跟着走）。所以修了判据之后不必写迁移脚本，让用户把那份文件重传一遍即可 —— 去重本来会让"重传"变成只回旧记录、类型错着不动，这条把它接上了
- **file 模块的分层（拆文件时照这个走）**：`mime.rs`（类型识别，纯函数不碰 DB）/ `limits.rs`（白名单与分档，前端镜像测试读它）/ `content.rs`（响应侧文本处理：名称清理、编码、内联策略）/ `extract.rs`（从可解析文档抽"可搜索纯文本"落 `file.text_content`：上传时**后台**抽 + 启动回填存量；能抽哪些由 `kind.rs` 的 `text` 列声明）/ `service.rs`（写侧业务，`service/maintenance.rs` 是其子模块 —— 子模块能直接访问父模块私有字段，**拆文件不该逼着把字段放宽成 `pub(crate)`**）/ `query.rs` / `repository.rs` / `model.rs`。测试与实现同文件（`test_support.rs` 提供共享夹具），改一处时断言就在旁边
- **PDF 正文抽取的选型与四条约定**（`extract.rs`）：用 `pdf_oxide`（纯 Rust、MIT/Apache-2.0），不是 `pdf-extract`/lopdf —— 后者**读不了 xref 链不规范的文件**（线性化 + 增量更新过几十次的书很常见；实测一份 12MB 教材直接 "invalid file trailer"，同一份 pdf_oxide 抽得出 2.7MB 文字）。① **逐页 `catch_unwind` 不是 panic 妥协**，四条理由：库的 `extract_all_text` 本身就是逐页循环（没有批量优化可捡）；我们只留 1 MiB，逐页能按预算早停（1312 页教材只抽前 ~480 页）；能区分"扫描件（→ `''`，不再重试）"与"整篇失败（→ NULL，下次重试）"；坏页只丢自己。② **上传后是后台抽**（`service::spawn_text_capture`，不进响应链）：大部头很贵（1312 页教材抽 1 MiB 约 94 秒），进程中途退出由启动回填自愈。③ **换抽取器要连带一次重抽**：v23 就是一条版本化修复（`repairs.rs` 的 `reset_pdf_text_content`）把 PDF 行的 `text_content` 置空，启动回填用新库重抽 —— 下次再换同理（"非 NULL 就不再抽"的回填策略不会自己更新旧正文）。④ **`Cargo.toml` 里 `office_oxide = "=0.1.9"` 那行不能删**：pdf_oxide 0.3.78 声明 `^0.1.9`，而 0.1.13 给 `DocumentIR` 加了字段、把发布版编译坏（missing field），钉住才编得过；上游修好后可删
- **搜索口径：多词 = AND + 命中高亮只有一处实现**。查询按空白拆词，**每个词都要命中**（`shared/search.rs` 的 `like_terms`，词间 AND、允许落在不同字段）——file 模块的两条 LIKE 路径与走 FTS 的几个模块（`fts_query` 把词用空格连起来，FTS5 空格本身就是 AND）因此同一语义；片段围着"文本里**最早出现**的那个词"切（`anchor_term`），多词查询才不会把上下文切歪。前端高亮全在 `web/src/shared/utils/highlight.ts`（先转义再插 `<mark>`，搜索页 / 命令面板 / 文件卡片三处消费）：**返回空串表示"没得高亮"，塞进 `innerHTML` 前必须退回纯文本**（文件模块的 `components/HighlightedText.tsx` 就是兜这个底，否则文件名会整段消失）。另一个坑：**node 环境跑的模块别从 `@shared/utils` barrel 引**——它会把整棵工具图拉进来，其中 @solidjs/router 导入期就碰 `window`（命令面板就是这么炸的，按路径引 `@shared/utils/highlight.ts`）
- **命令面板（⌘K）的四条口径**（`web/src/platform/command-palette/`）：① **idle（无前缀）必须有用**：空输入列可跳页面（最近访问优先），打字 = 本地模糊匹配 + 末尾一条「在站内搜索「q」」（选中切 `?` 模式原地看结果）——`query()` 剥前缀是**按模式**的（idle 不剥，曾经无条件 `slice(1)` 把"文件"吃成"件"）；② **`/` 导航只列实路径**（`isConcretePath`，在 `config/paths.ts`）：`NAV_ITEMS` 里的详情页模板（`/file/:id`）不是目的地，跳过去是坏页面；具体文件/卡片走 `?` 站内搜索；③ **IME 闸门**：`onInputKey` 与所有"回车即提交"的输入框都过 `isImeComposing`（中文用户按回车选候选词会误提交/关面板），搜索在组字期间不发请求（`usePaletteSearch` 的 `composing` 闸门）；④ **a11y**：焦点留在输入框（`aria-activedescendant` 指向高亮项、可选项 id 由 `optionDomId` 一处拼），Tab `preventDefault` 不出面板，关闭时把焦点**还给打开前的元素**（微任务里，见 `close()`），选中项**永不落在分组标题**上（落在标题上回车会静默关面板）。测试在 `CommandPalette.render.test.tsx`（jsdom，需 mock router/auth/api；jsdom 没 `scrollIntoView`，补桩）
- **列表缩略的 HTML 提取要按"窗口是被 Range 截断的"来写**（`web/src/platform/file/model/thumbPreview.ts` 的 `dropTruncatedTail`）：正文兜底时"去掉 `<style>`/`<script>` 块"靠的是成对标签，**块被 4KB 窗口切在边界上就配不到闭合标签**，里面的 CSS/JS 会被当成正文显示（真实事故：SingleFile 保存页里 Emotion 注入的 `<style data-emotion=…>` 横跨窗口边界，卡片上出现一长串 `@keyframes animation-xykzx5{…}`；同一批保存页都有这段 —— Emotion 的哈希按内容算，所以四个站点的注入样式哈希相同）。同类的半截标记（`<meta charset="u`）也一并丢掉。凡是从定长窗口里读文本的地方都要先问"边界上会不会留半截东西"
- /api 下未知路径返回 JSON 404，不走 SPA HTML fallback；SPA fallback 只服务非 /api 路径
- **按用户给的 URL 出网要过两道 SSRF 防线**（`shared/outbound.rs` —— 业务无关的基础设施，当前调用点是公开的 `/bookmarks/favicon` 与需登录的 `/bookmarks/fetch-url`）：① URL 里是 **IP 字面量**就按 `is_public_ip` 拒 —— 这一道不能省，**hyper 的连接器对 IP 字面量跳过 DNS 解析直接连**，自定义解析器根本看不到这类 URL；② `PublicOnlyResolver` 剔掉解析结果里的非公网地址（校验与建连用同一份结果，DNS rebinding 绕不过）。favicon 那侧原有的 `looks_like_domain` 只管字符串长相，挡不住"自己的域名 A 记录指向内网"（实测 `http://127.0.0.1.nip.io:3000/` 改前能连到自己的内网端口）。重定向要逐跳校验（`Policy::limited` 只看跳数不看去向）；`is_blocked` 顺着错误链认自己人，好把"被我们拦了"与"对面连不上"分开报。**别用到 AI 代理那侧** —— 那是用户自己配的 endpoint，指 `127.0.0.1:11434`（本地 Ollama）是正当用法
- stylelint `declaration-no-important` 门禁：CSS 中禁止 `!important`；print 样式与 reduced-motion 已用块级 `stylelint-disable` 豁免，其他场景不要加
- 容器查询 `@container` 新组件优先使用：页面级布局用 `@media`（视口断点），组件级自适应用 `@container`（宿主容器宽度），详见 global.css 断点分工注释；使用容器查询需在宿主元素上声明 `container-type: inline-size`
- **X-Frame-Options 必须用 `SAMEORIGIN` 而不是 `DENY`**：详情页的 PDF 预览是同源 `<iframe>`，DENY 会连同源一起拦（Firefox 报 "will not allow Firefox to display the page if another site has embedded it"）。另外实测：给 `header` 指令写 matcher（`header @x path ...`）**不会覆盖**站点级同名头，别指望局部放宽
- 文件内容响应是 `Cache-Control: private, max-age=86400`：Cloudflare 默认按扩展名缓存 `/api/**/*.pdf|png|...`，若用 `public, immutable` 则响应头一旦需要变更（如上面那条 XFO）就永远传不到客户端，只能手动 purge
- 启动自检前必须先建上传目录（`app::startup::prepare_and_check` 固定了这个顺序）：`uploads/file` 不存在时自检会判为致命问题，systemd 又把它变成重启循环 —— 线上踩过一次，回归测试是 `creates_upload_dir_before_checking`
- **列表缩略图（`/api/file/{id}/thumb`）的几条约定**：① 产物在 `uploads/file/thumbs/{content_hash}-{宽}.{jpg|png}`，**目录名不是 12 位 `stored_id`**，所以一致性扫描与孤儿清理天然忽略它 —— 安全但也不会回收，回收只在 `service::maintenance::prune_thumb_cache()`（改目录名要同步一致性扫描、启动自检与这里）；② 宽度只认阶梯 160/320/640/1280（前后端两处常量要同步：`thumb/mod.rs` 的 `WIDTH_LADDER` ↔ `web/src/platform/file/model/thumbnail.ts` 的 `THUMB_WIDTHS`）；③ 像素数 >60MP **回原图**（不报错、不硬解 —— 后者会把 `MemoryMax=1G` 吃穿）；④ 视频走 **ffmpeg 子进程**（`thumb/video.rs`，隔离是目的，别为省一个二进制链 libav* 进主进程），ffmpeg 缺失就永久降级为后缀徽章（进程内只探一次），二进制随产物走：`just fetch-ffmpeg` → `vendor/ffmpeg/bin` → `build/bin`，**`deploy/ffmpeg.lock` 没填 sha256 就拒绝下载**；⑤ 要上 `immutable` 缓存前必须先给 URL 加内容哈希版本段（否则内容变了客户端一年不回来问）
- **开发环境要视频海报帧就得有 ffmpeg**：`just fetch-ffmpeg` 取静态构建到 `vendor/ffmpeg/bin/`（版本与 sha256 见 `deploy/ffmpeg.lock`，未填哈希时拒绝下载），再在 `.env.dev` 里把 `FFMPEG_PATH` 指过去（`.env.dev.example` 有那两行注释）。**没有也只是降级**：视频显示后缀徽章 + 时长，其他功能不受影响。发布时 ffprobe 默认不带（各 ~77MB，它只做时长回填）：`WITH_FFPROBE=1 just build` 才带（静态构建已实测在服务器上可运行，是 `not a dynamic executable`）
- **PDF 首页缩略图在**前端**（pdf.js），不在后端**：PDF 只能靠真渲染器 —— ffmpeg 解不了（静态构建里没有 PDF 解码器，实测报 `Invalid data found`），poppler/mupdf/pdfium 都没有"随产物走"的静态发行渠道。所以 `web/src/platform/file/model/pdfThumb.ts` 动态 import pdf.js（`pdf-*.js` 121KB gz 独立 chunk + `pdf.worker.min-*.mjs` 355KB gz 资源，**首屏与 FileList chunk 里不得出现 pdf.js 内部符号**），渲染第 1 页到 320px canvas → blob URL；**卡片进入视口才开始**（IntersectionObserver，成本比文本片段高两个数量级）；只对公开、未缺失、≤200MB 的 PDF 触发。两个环境前提：vite 的 `?url` 把 worker 发成独立资源（**部署后 curl -I 看一眼它是不是 `text/javascript`** —— 模块 worker 的 MIME 不对会被浏览器拒绝），Caddy 的 CSP 里 worker 走 `default-src 'self'`（已满足，动 CSP 时注意）
- **时长（`duration_ms`）有两条来源**：上传前前端读一次 `loadedmetadata`（`lib/mediaDuration.ts`，随 `?duration_ms=` 传），以及出视频海报帧时用 ffprobe 回填（`set_duration_ms_if_null`：**只在为空时写、不动 `updated_at`**；别用 `update_metadata` 代替，它一次写宽高时长三个字段会把宽高抹成 NULL）。后端只对 video/audio 采纳客户端报的值（值域 0<时长≤24h）
- **构建机与服务器的 glibc 代差会让产物"加载即失败"**：本机 WSL 是 Ubuntu 24.04（glibc **2.39**），服务器是 22.04（glibc **2.35**）。Rust 的 `std::process::Command` 在 glibc ≥ 2.39 上链接会绑定新增的 `pidfd_spawnp@GLIBC_2.39`，于是 **Sep 12 那版还能跑、带 ffmpeg 子进程的那版就跑不了**（`src/modules/file/thumb/video.rs` 是后端唯一的 spawn 点）——它与构建/部署工具无关，今天用任何工具构建都会产出跑不起来的产物。对策是 **musl 静态构建**：`BUILD_TARGET=x86_64-unknown-linux-musl` + `sudo apt install musl-tools` + `rustup target add x86_64-unknown-linux-musl`，产物不含任何 `GLIBC_` 符号。`just check` / `just deploy` 会在**动远端之前**比对"产物要求的最高 GLIBC 版本 vs 远端 `getconf GNU_LIBC_VERSION`"，不匹配直接拒绝（`xtask/src/compat.rs`）
- **远端 sudo 是按命令白名单授权的**（不是全量 NOPASSWD）：`sudo -n true` 会报"要密码"，但白名单里的 `/bin/systemctl` 与 `tee /etc/caddy/Caddyfile`、`tee /etc/systemd/system/*.service`、`chmod 600` 可以免密跑。所以**改动任何 sudo 调用形式都要同步确认 sudoers 仍放行** —— 形式一变就匹配不上，sudo 退回要密码，而部署无人值守只会失败。`just check` 会逐条核对部署真正用到的那几条（`xtask/src/cmd/check.rs` 的 `REQUIRED_SUDO`）
- **改 Caddy 配置是"先校验候选、通过才覆盖"**（`xtask/src/caddy.rs`）：候选写到 `$REMOTE_DIR/tmp/Caddyfile.<ts>.new`，在**那个文件**上 `caddy validate`，通过了才 `sudo tee /etc/caddy/Caddyfile`。别改成"先覆盖再校验" —— 那样坏配置会落盘，运行中的 Caddy 还用内存里的旧配置，下次重启才炸。想先看渲染结果：`cargo xtask render caddy`（可与现网 `ssh <host> 'cat /etc/caddy/Caddyfile'` 逐字节 diff）
- **回滚与部署恢复**（`just rollback` / 部署失败时的自动恢复，`xtask/src/rollback.rs`）：临时目录在 `$REMOTE_DIR/tmp`，**别挪回 `$REMOTE_BASE`（`/opt`）下** —— 那是 root 的，ssh 用户建不了，老 deploy.sh 正因如此让回滚必然失败。回滚只替换 `brainbow` 与 `dist`，**不碰** `data/`（数据库与 uploads）与 `bin/`；代码备份与数据库备份**共用同一个时间戳**（`code_<ts>.tar.gz` + `db_deploy_<ts>.db`），回滚据此精确配对。部署的自动恢复是显式的 Result 处理（不是 bash 的 ERR trap）：先重启现有产物（给足 30 秒探测，**别只探一次** —— 服务起来要 bind 端口、开库、跑自检），不行再回滚，再不行交给人。**回滚代码时可能连数据库一起回**：部署前后各读一次 `PRAGMA user_version`，变了（这次部署跑过迁移）就一并还原 `db_deploy_<ts>.db` —— 迁移的版本闸门是"库版本高于程序支持版本就拒绝启动"，只回代码会得到"旧代码 + 新库"这个必然起不来的组合。这条判断有单测盯着（`needs_db_restore`），别简化成"总是连库一起回"（会白白覆盖用户数据）或"只回代码"
- **部署顺序：上传在停服之前**（`xtask/src/deploy.rs` 的 `critical_path`）：产物先传到 `tmp/deploy_<ts>/`（这一步服务照常对外），再停服 → 备份 → 就位 → 起服。上传是停机时间里的大头（4MB dist，带 ffmpeg 时 +76MB），别挪回停服之后。就位那一步顺带落 `service/REVISION` —— 构建时写进产物的 git 版本（`build/REVISION`，`local::git_revision`，工作区脏则带 `-dirty`），是"线上跑的是哪个提交"的唯一记录，`just info` 显示它；`warn_if_stale` 也比它（产物版本 ≠ HEAD 就是拿旧产物在部署）
- **备份的校验在部署收尾**（`db::verify_backup`）：`backup_at` 只对**源库**做 quick_check，产出的那份文件要到恢复时才被检查 —— 那时已经晚了，所以收尾会再 `quick_check` 一遍刚拍的备份（非关键路径，失败只告警）。"没跑成"（dry-run / 远端没有 sqlite3）走 `Check::Skipped`，与"通过"分开，不许混说成"通过"。另记：备份与原件**同盘**（`$REMOTE_DIR/backup`），异地副本目前只有手动 `just db-pull`
- **上传根（`UPLOAD_DIR`）必须指向 data 下**：它决定文件服务的 `{UPLOAD_DIR}/file`、favicon 缓存的 `{UPLOAD_DIR}/favicons`。不配的话会退回默认的相对路径 `uploads`，而 systemd 的 `WorkingDirectory` 是 `service/` —— 用户数据就住进了"随时可整体替换的代码目录"（老回滚的 `rm -rf $SERVICE_DIR` 正是会删掉它那种操作）。同理，**任何按路径取值的环境变量都得保证自检与 unit 一致**：自检命令少传 `UPLOAD_DIR` 会去检查一个与服务无关的目录，报出假的"上传目录不可用 / 缺失 N 个文件"（真实踩过）
- **按路径取值的地方一律从配置派生，别写死相对路径**：`favicon.rs` 曾把 `uploads/favicons` 写成常量，于是改了 `UPLOAD_DIR` 之后文件服务搬走了、favicons 留在原地（数据劈成两半）。file 模块修过一次同类问题，注释里还留着"别再硬编码 uploads/file"——同样的坑别再踩第三次
- **备份清理要按类分开算**（`xtask/src/db.rs` 的 `prune`）：数据库备份与代码备份**各自**保留 30 天 / 20 份。合成一个池子会让两类互相挤占名额、保留份数实际减半。删数据库备份要连 `-wal`/`-shm` 一起删（`db_*.db` 这个 glob 匹配不到兄弟文件，只删主文件它们会永远堆积）
- **`BACKUP_DIR` 是"应用只读、部署工具写"的那一个路径**：备份由 xtask 写到 `{根}/backup`，unit 里注入的就是它算出来的那个目录；应用（`modules/admin/system.rs`）只拿它来报"备份多少份、占多大、最近一次什么时候"（/admin 的「服务器」卡片）。改部署侧的备份位置就要让 unit 跟着改，否则 /admin 会报一个不存在的目录。开发机没有这个概念 —— 后端给 `None`，前端显示"—"（**别给它加相对的开发默认**，那会让人以为备份真在那儿）
- **/admin 的「服务器」信息全是"尽力而为"**（`modules/admin/system.rs`）：内存/负载读 `/proc`、磁盘走 `statvfs`（`libc` 只挂在 unix 目标上）、目录占用是递归取元信息。任何一项读不到就是 `None`，前端显示"—"，**绝不把"读不到"报成 0**（后端在 Windows/macOS 上开发时就是这样）。加新指标时保持这个约定
- **3DGS 预览（`.ply`）的三条硬约定**（`web/src/platform/file/viewers/splat/`）：① 自动取景必须**按点的投影分布 + 视口宽高比**算距离（`fit.ts`），且**分位与画面占用是一对、必须保持 `FIT_MASS = 0.9` / `FIT_FILL = 0.85`**——这两个数是照参考实现自己 demo 的实测定的（train.splat 在它的默认机位下点的 90 分位 = 0.83、出画 8.5%）；回到 0.99 会让 1% 的离群高斯把相机拽远，实体部分只占画面 30~57%（又小又远），而 0.99 分位看着"贴框"、数字上查不出来。参考实现那份写死的 `defaultViewMatrix`（6.55 机位）**不能照抄**：实测用户场景有 40~55% 的点出画（相机在模型内部）；② `.splat-pane` 的**底色固定用暗色且与主题解耦**：高斯是预乘 alpha + 透明画布，合成在 paper 主题的近白底上会整体发灰（参考实现整页是黑底），所以配套文字色也用浅色；③ **视图矩阵三行是 右 / 屏幕向下 / 前**（不是"向上"）：投影在 y 上取负，第二行放 -y 会让画面整体上下颠倒、基变左手系，而取景那批 `max(|ndc|)` 断言查不出来；环绕定点距离取**初始取景距离的 0.61 倍**（对齐参考实现的 4 / 6.55），别写死也别用全距离。另：**绘制一律走 rAF 合并**（`SplatViewer` 的 `requestFrame`），排序"没变"时只回 `sort-skipped`（不回索引，但**答复不能少**）。详见 `doc/design/file-service.md` §8.5
- **后端编译速度已定论（2026-09-25 实测，别再重复讨论）**：瓶颈既不是链接也不是 debuginfo，而是"整 crate 的 proc-macro 展开 + 类型检查"被 bin/check/test/clippy/musl 各付一遍。链接只占 1.1 s —— **别装 mold/lld**（`.cargo/config.toml` 里那段注释已被替换成这个结论）；debuginfo 只影响体积（309 MB 里 76% 是 debug info），调档位不省时间。已落地的两条：**rust-analyzer 独占 `target/rust-analyzer`**（`.zed/settings.json` 的 `lsp.rust-analyzer.settings.cargo.targetDir`，不分家时抢同一把 target 锁、实测慢 2–4 倍）、**`jobs = 8`**（16 核但 7.6 GB 内存，拉满会吃穿 swap）。另记一个坑：**中断的构建（Ctrl-C / cargo-watch 重启 / 杀进程）会留下 0 字节的 rlib/rmeta，而 cargo 当它"最新"**，症状是 `can't find crate for \`zip\`` 之类；恢复用 `cargo clean -p <报错的包>`，构建脚本产物缺失（`include!(env!("..._PATH"))`）时删 `<target 树>/.fingerprint/<包>-*`。细节与实测表见 `doc/guides/backend.md` 的「构建速度」
