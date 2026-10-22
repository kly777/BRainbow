# 模块清单

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

后端模块位于 `src/modules/`；前端模块按物理层分在 `web/src/{domains,capabilities,platform,tools}`（**没有 `web/src/modules` 目录**，`@modules/<name>` 只是兼容别名，见下文）。API 统一挂载在 `/api` 下，除下列公开端点外默认需要认证（JWT 或 X-API-Key）：

公开端点：`/api/user/register`、`/api/user/login`（均限速）、`/api/bookmarks/favicon`、`/api/file/{stored_id}/data/{filename}`、`/api/file/{stored_id}/preview` 与 `/api/file/{stored_id}/thumb`（**公开文件**的内容/预览/缩略图路由 —— Markdown 里的 `<img src>` 不带 Authorization，所以内容路由无凭据；私密文件仍要凭据）。`/api/health` 是健康检查、不经过认证（挂在 `create_router`，不在 api.rs 的认证组里）。其余全部需认证；`/api/admin`、`/api/db` 另需管理员角色。

## 后端模块 × API 前缀

| 模块 | 后端 API 前缀 | 功能 |
|------|---------------|------|
| user | `/api/user` | 注册/登录/当前用户/改密/登出 |
| auth（非业务模块：handler 在 `app/http/auth.rs`，路由装配于 api.rs） | `/api/auth` | API Key 生成/列表/删除 |
| task | `/api/tasks` | 任务树/依赖/状态/搜索/统计/建议；`task_block`（feasible/planned）与 `task_series`（循环任务）也在这组路由下（`/series`、`/{id}/blocks`、`/blocks/{id}`）；`/api/tags` 的标签补全由 task 提供 |
| calendar | `/api/calendar` | 日历事件与事件系列（生日/纪念日/节日）、节日订阅、农历转换，以及与 `task_block` 的并集读模型（`/items`） |
| card | `/api/cards` | 知识卡片 CRUD/搜索 |
| onto | `/api/onto` | 本体管理 |
| sign | `/api/sign` | 能指-所指关系 |
| text | `/api/text` | 多标签纯文本 |
| file | `/api/file` | 通用文件服务（可见性、缩略图、正文抽取、标签；v15 起取代 media 模块） |
| mem | `/api/mem` | FSRS 间隔重复记忆（含标签与导入） |
| reading | `/api/reading` | 英语阅读、词库、认识率 |
| bookmark | `/api/bookmarks` | 书签与标签、HTML 导入、favicon |
| conv | `/api/conv` | 对话历史搜索/详情 |
| chat | `/api/chat` | AI 对话树、预设提示词、记忆卡片生成 |
| ai | `/api/ai` | AI 设置与代理调用（独立限速桶，20 次/分钟） |
| search | `/api/search` | 跨模块全局搜索（`SearchPort` 注册：mem / card / task / bookmark / onto / text / reading / conv / chat / file） |
| db_viewer | `/api/db` | 管理员数据库查看；**不是 feature gate** —— `Cargo.toml` 没有 `[features]`，模块随产物编译，路由只挂在管理员组（`auth` + `require_admin`） |
| admin | `/api/admin` | 系统设置（开放注册）/JWT 密钥轮换/服务器信息 |

## 前端模块与页面

物理分层：`web/src/{app,capabilities,domains,platform,tools,components,config,shared}`。`@modules/<name>` 是**兼容别名**：`config/module-registry.ts` 的 `MODULE_KINDS` 把每个模块名映射到 `domains` / `capabilities` / `platform` / `tools`，`vite.config.ts` 据此生成 alias。新代码优先用层别名（`@domains`、`@capabilities`、`@platform`、`@tools`）或模块公共入口 `index.ts`。

模块分类（`config/module-registry.ts`，共 21 个；未登记会被 `app/layer-boundaries.test.ts` 拦下）：

| 层 | 模块 | 页面/职责 |
|----|------|-----------|
| domains（业务域） | task | `/task` 工作台（列表/看板/日历/依赖图）、`/task/:id` 聚焦页 |
| | card | `/card` 列表、`/card/:id` 详情、`/card/add`、`/card/edit/:id` |
| | ontology | `/ontology` 列表、`/ontology/:id` 详情 |
| | mem | `/memory` 学习、`/memory/add` 添加、`/memory/manage` 管理 |
| | reading | `/reading` 列表、`/reading/unknown` 不认识词、`/reading/:id` 文章 |
| | bookmark | `/bookmark` 分组视图、`/bookmark/manage` 管理、`/bookmark/:id` 详情 |
| | conv | `/conversation` 搜索、`/conversation/detail/:id`、`/conversation/concept/:id` |
| | text | `/text` 多标签纯文本编辑器 |
| capabilities（跨域能力） | chat | `/chat` 对话树、`/chat/prompts` 预设、`/chat/mem` 记忆卡片生成 |
| | home | `/` 首页 |
| | quick-capture | 全局快速记录浮窗（Shift+Tab，常驻 Layout） |
| | search | `/search` 站内搜索结果页（检索能力来自 command-palette） |
| platform（平台能力） | file | `/file` 列表、`/file/:id` 详情 + 预览查看器注册表 |
| | db | `/db` 管理员数据库查看 |
| | admin | `/admin` 管理员设置 |
| | key | `/key` API Key 管理 |
| | auth | `AuthDialog` / `AuthGuard`（登录注册与路由守卫，常驻 Layout） |
| | ai-setting | `AiSettingsModal`（AI 设置弹层，无独立路由） |
| | command-palette | ⌘K 命令面板（常驻 Layout） |
| tools（独立小工具） | color | `/color` 全局主题配色切换 |
| | rainbow | `/rainbow` 彩虹生成器 |

## 新增模块建议

1. 后端：`src/modules/<name>/` 建 `mod.rs` / `handler.rs` / `service.rs` / `query.rs` / `repository.rs` / `model.rs`
2. 在 `src/app/http/routes/api.rs` 挂载：按需放进公开组、认证组或管理员组（注意静态路径排在 `{id}` 之前）
3. 前端：按分层放到 `web/src/{domains|capabilities|platform|tools}/<name>/`，内部用 `model/`（纯规则）、`view/`（页面状态）、`data/`（多文件数据适配）、`components/`
4. 在 `config/module-registry.ts` 登记模块分类（漏登记会被 `app/layer-boundaries.test.ts` 判为未分类模块）
5. 在 `config/paths.ts`、`config/navigation.ts`、`app/routes.ts` 登记路由（PAGE_LOADERS 是 `Record<PathValue, PageLoader>`，漏加 loader 直接编译失败）
6. 若新增表：在 `crates/db/src/schema/tables.rs` 加声明 + `SCHEMA_VERSION += 1`（时间列进 `time.rs`、全文索引进 `fts.rs`）→ `just sqlx-prepare`；删表/删列/数据搬移需手工处理
7. 补测试（后端模块内 `#[cfg(test)]`；前端 `*.test.ts(x)`）
