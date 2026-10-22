# 架构

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 分层契约

```
main
 ├── app（组合层：HTTP 路由、认证、限速、装配）
 ├── db（facade：重导出 brainbow-db）
 ├── modules（业务域）
 └── shared（纯工具/错误/配置，不依赖业务模块）

modules     → brainbow-db + shared
brainbow-db → sqlx、tracing（不依赖 app / shared / 业务模型）
shared      → 无依赖
```

- `app` 负责把各 `modules` 的路由、状态、中间件组合起来。
- 业务域之间不应互相 `use` 对方实现；需要跨域时经 port trait（如 `ai/port.rs`、`mem/port.rs`、`admin/port.rs`）或 `app` 层协调。
- 建表与迁移的实现在 workspace crate `brainbow-db`（`crates/db/`：连接/PRAGMA、schema 声明、迁移、自检）；应用里的 `src/db/mod.rs` 只是 facade（`pub use brainbow_db::{connect, migrate, verify}`）。**repository 仍留在各模块**，不要把业务查询塞进 db crate（那会让 db 依赖所有领域模型，变成 god crate）。模块内禁止自行 `CREATE TABLE`。

## 后端模块结构

每个业务模块通常包含：

| 文件 | 职责 |
|------|------|
| `mod.rs` | 路由定义 |
| `handler.rs` | HTTP handler，负责请求/响应转换与校验 |
| `service.rs` | 命令侧服务：写操作、业务规则 |
| `query.rs` | 查询侧服务：只读、聚合、推荐 |
| `repository.rs` | SQL 数据访问，使用 sqlx |
| `model.rs` | 领域模型、请求/响应 DTO |

典型流程：

```
HTTP → handler → service/query → repository → SQLite
```

单文件过大再拆子目录（范例：task 的 `repository.rs` / `handler.rs` 各拆多文件）。模块与 API 前缀对照见 [modules.md](./modules.md)。

## 前后端交互

- 前端统一通过 `web/src/shared/api` 发起请求（`request.ts` 是唯一的 fetch 收口），携带 JWT 或 API Key。
- 401 由全局拦截器弹登录框（静默派发 `AUTH_REQUIRED_EVENT`）；403 只 toast 提示。
- 错误响应统一为 `{code, message, details?}`（`shared/error_types.rs`）；前端 `extractErrorBody` 优先读它，读不到（空体 / HTML 页）才退回状态码。502/503/504 由 `describeGatewayStatus` 换成能对上现象的说明 —— 那几个码通常是中间层编的，只在 `HTTP 502` 这种文案上停在原地没法排查。
- **提取器拒绝也走这套错误体**（`app/http/rejection.rs`）：axum 的 `Json`/`Query`/`Multipart` 失败时自己回 `text/plain` 英文原文（畸形 JSON、缺 Content-Type、体积超限、405），未认证就能触发且带着框架措辞 —— 这层统一改写成 `{code, message}`（只对 `/api` 生效，原文进 tracing 日志）。
- handler 里 panic 由 `app/http/panic.rs` 的 `CatchPanicLayer` 兜成 500（带 panic 消息，并记一条 tracing 日志）。少了它，panic 会把连接直接丢掉：客户端拿不到任何响应体，代理只能自己编一个 502 出来，真实原因只剩服务端 stderr 一行。
- 后端 API 统一前缀 `/api`；前端开发代理 `/api → :3000`。
- 前端路由由 `web/src/config/paths.ts` + `navigation.ts` + `app/routes.ts` 单一来源派生。

## 认证

- 密码 bcrypt 哈希；用户名/密码登录 → JWT（HS256，TTL 默认 864000s＝10 天，`JWT_TTL_SECS` 可调）。
- 支持 API Key 认证（`X-API-Key`；明文只在创建时返回一次，库里存 SHA-256）；**首个注册用户自动成为 admin**。
- 认证边界是唯一把凭据翻成 `Actor` 的地方（`app/http/auth.rs` 的 `auth` 与 `optional_actor`）；handler 一律 `Extension(actor): Extension<Actor>`。凭据有效但用户已被删 → 401 `SESSION_INVALID`（不是 500）。
- 管理员接口额外经过 `require_admin` 中间件。
- 登录/注册接口有限速（每 IP 10 次/60s；`/api/ai` 另有 20 次/分钟的独立桶）。限速键优先 `CF-Connecting-IP`，取不到时退到 `X-Forwarded-For` 的**最后一个**合法 IP（最靠近本进程的那一跳），最后才是直连 peer —— **绝不取 XFF 首值**：CF 对 XFF 是追加语义、客户端自填的值留在最前，按首值取键等于把限速键交给请求方。

## SQL 策略

- 静态 SQL 全部使用 sqlx 编译期宏，离线数据在 `.sqlx/` 提交。
- 运行时动态 SQL 使用 `QueryBuilder`（例如 IN 列表、动态筛选），并保持测试覆盖。
- 本地编译是在线校验（`.cargo/config.toml` 的 `[env]` 设了 `SQLX_OFFLINE=false` + `DATABASE_URL=sqlite:brainbow.db`），所以 schema 变更的顺序是：**先让库迁移 → 再写引用新列的 SQL → 再 `just sqlx-prepare`**；反过来会卡死。release 构建走另一条路：`just build` 显式设 `SQLX_OFFLINE=true` 并摘掉 `DATABASE_URL`（只 `env -u` 不够，`[env]` 会注回去）。
- SQL 变更后必须运行 `just sqlx-prepare` 并提交新的 `.sqlx/` 文件。

## 配置

配置由 TOML 驱动，集中读取于 `src/shared/config.rs`（`config/app.<env>.toml`），部署/构建字段分别读 `config/deploy.toml`、`config/build.toml`。完整字段见 `config/README.md`。

| 字段 | 默认 | 说明 |
|------|------|------|
| `[database].url` / `file` | `sqlite:brainbow.db` | SQLite 位置；设了 `BRAINBOW_ROOT` 时按 `{root}/data/<file>` 派生 |
| `BRAINBOW_ROOT` | 未设置 | 部署根；派生 `data/`、`uploads/`、`backup/`（部署侧同一根叫 `REMOTE_BASE`/`APP_NAME`） |
| `[server].port` | `3000`（dev）/ `8080`（prod） | 后端端口 |
| `[server].bind` | `127.0.0.1` / `0.0.0.0` | 绑定地址 |
| `[security].jwt_ttl_secs` | `864000` | JWT 有效期（秒），默认 10 天 |
| `[security].allow_register` | `false` | 是否开放注册（运行时可被 admin 写 DB 覆盖） |
| `[uploads].dir` | `uploads`（或 `{root}/data/uploads`） | 上传根；文件服务用其下 `file/` |
| `[cors].allow_origins` | `["http://localhost:3000"]` | 来源数组；空数组才完全不加 CORS 层 |
| `config/secret.toml` | 随机生成 | JWT 密钥文件；生产必须持久化（实际生效密钥以 DB `app_settings` 为准） |
