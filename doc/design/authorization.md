# 授权与数据归属（Authorization）

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 一句话：**admin 全管；普通用户只管自己创建的。** 判据只有一处 —— `src/shared/actor.rs`。

## 1. 规则矩阵

| 角色 | 读 | 改 / 删 |
|------|----|---------|
| admin（`claims.role == "admin"`） | 全部 | 全部 |
| 普通用户 | 自己创建的 | **只有自己创建的** |

三条附带约定：

- **越权按"不存在"处理**：接口回 404（不是 403），与 file 模块的既有口径一致 —— 不泄露
  "这个 id 存在但不是你的"。
- **老数据已认领**：迁移 v20 把 `user_id IS NULL` 的历史行归给了当前 admin（当前
  `schema::SCHEMA_VERSION = 26`，v20 是当时那一步认领）。`NULL` 的旧语义
  （"共享数据，任意登录用户可读写"）**已取消**；无主行现在只有 admin 看得见、改得动
  （fail-closed，见 `isolation_tests::ownerless_rows_are_admin_only`）。
- **模块边界已收口**：旧的 `time_window` 模块在 v26 并进了 task 的 `task_block`
  （v26 迁移已完成，旧 `time_window` 表已从当前 schema 删除），子表随父的模板改成
  `task_block`（见 §3.1）。本文里凡是"时间窗口"都按 `task_block` 读。

## 2. 唯一的判据

`src/shared/actor.rs`：

```rust
// 字段**私有** + 只读访问器：拿到 &Actor 之后改不动（actor.is_admin = true 这种写法不存在）
pub struct Actor { user_id: i32, is_admin: bool }

impl From<&Claims> for Actor   // 生产代码里唯一的构造点（认证边界）
Actor::user(id) / Actor::admin(id)   // 仅 #[cfg(test)]，生产编译单元里造不出"凭空的管理员"

Actor::user_id() -> i32
Actor::is_admin() -> bool
Actor::owner_scope() -> Option<i32>   // admin → None；其余 → Some(自己)
Actor::can_read(owner: Option<i64>)   // 行级判断（单行读取/写前校验用）
Actor::can_write(owner: Option<i64>)
```

行级判据按 **i64** 收归属（SQLite 的整数就是 i64，而各表族在 Rust 侧类型不统一：
`file.user_id` 是 `Option<i64>`，不少表是 `Option<i32>`，调用点 `map(i64::from)`）。

**SQL 侧只有一种写法**：把 `owner_scope()` 绑到参数，条件写成

```sql
(?1 IS NULL OR {归属列} = ?1)          -- 静态 SQL（query! 宏）
AND ( ? IS NULL OR {归属列} = ? )       -- QueryBuilder：push_owner_scope(qb, actor, col)
```

admin 绑 `NULL` → 条件恒真（全量）；普通用户绑自己的 id → 只看/只动自己的行。**一条 SQL
同时服务两档角色**，不用为 admin 另写一条（两处 SQL 迟早不同步）。各层（handler →
service/query → repository）都传 `&Actor`，不让任何一层自己拼 `user_id`。

## 3. 各模块的可见性口径（不是一套打天下）

| 模块 | 口径 | 备注 |
|------|------|------|
| card / task / calendar / onto / sign / bookmark / reading / conv / mem / chat | `(? IS NULL OR user_id = ?)` | 标准口径 |
| **text**（草稿本，`PUT /text` 是**整体替换**） | 读：标准口径（admin 全部）；**写：只替换自己那一份** | PUT 的语义是"替换我的集合"：按 admin 全量口径删会让管理员保存一次清空所有人的草稿。集合式写入一律用 `actor.user_id`，不用 `owner_scope` |
| **file** | 公开文件（`is_private = 0`）对**所有人**可见（含未认证）；私密文件仅上传者与 admin。写（改名/标签/可见性/删除）只认上传者与 admin | `repository::push_visibility`、`query::is_visible`、`query::content_access` 三处要同步；写侧是 `service::ensure_can_mutate`（越权 404） |
| 子表（`chat_node` / `reading_article_word` / `task_dependency` / `task_block` / `revlog` / `mem_*` / `file_meta` …） | **随父表** | 大多没有 `user_id` 列（`task_block` 有，但只是从父任务抄下来的冗余值），必须回到父表用同一判据，别在子表上另立规则 |

### 3.1 子表随父：怎么落地（2026-09-30 定，v26 换成 `task_block`）

**读**：SQL 里连到父表，用同一个形状 ——

```sql
-- task_block 这类"有 task_id 的子表"
AND (?1 IS NULL OR EXISTS (SELECT 1 FROM task t WHERE t.id = b.task_id AND t.user_id = ?1))
```

`task/repository` 的 `find_blocks_by_task` 就是这么写的（join `task` 后
`WHERE (?1 IS NULL OR t.user_id = ?1)`，绑 `owner_scope()`）；`task_dependency` 同。

**写**（改/删）：service 层先取父行的 `user_id`，再走 `actor.can_write(owner)`，越权回 404
（与行列判断同一判据、同一语义）。不要只在 SQL 里过滤 —— 写路径需要区分"不存在"与
"不是你的"，而这在响应上都要装成 404。task 的写路径统一走 `TaskService::ensure_task_owned`
（`task/service.rs`，`pub(crate)`；`task/block.rs` 里还有一份同名私有实现）：
建块 / 改块 / 删块 / 改系列 / 挂依赖的两端都先问一句"这个任务是不是调用者的"。
`task_block` 自己也带 `user_id` 列，但那只是写入时从父任务抄下来的值，
**判据不读它** —— 别再在子表上另立一套。（`task_series` 是另一回事：它没有父表，
按标准口径直接用自己的 `user_id`。）

**历史教训（v26 已随模块删除而消解）**：被替换掉的 `time_window` 模块当年有两处洞 ——
读（`by_id` / `list_by_task` / `stats` / `conflict`）完全不校验父任务归属，任何登录用户按 id
就能读到别人的时间窗口；task 侧的 `find_time_windows_by_task(_user_id, …)` 参数以下划线
开头，即 **user_id 被忽略**，于是写路径也没校验"这个 task 是不是调用者的"。
回归测试：`isolation_tests::task_block_follows_its_parent_task`、
`task/authz_tests::task_blocks_follow_owner_and_overlap_is_scoped`。
**教训**：子表的查询函数参数里出现"下划线开头的 user_id"就是洞；只有收 `&Actor`
才能让"漏改"变成编译错误。

file 的 `is_private` 是"看不看得见"，不是"是不是你的"：**公开可读 ≠ 谁都能改** —— 改名/删除
仍只认上传者与 admin。

## 4. 落地状态（已合入 main）

**12 个业务模块全部接完**（card / text / onto / sign / conv / reading / calendar / bookmark /
task（含 `task_block`、`task_series`）/ mem / chat / file；当时分支上 `cargo test` 811 passed /
clippy 干净，现在的数字看 `just test`）。模块清单见 `AGENTS.md` 与 `doc/guides/modules.md`。

- [x] v20 迁移：无主行认领给当前 admin（幂等；没有 admin 就跳过；不碰 `api_key`）
- [x] `Actor` 接缝 + `push_owner_scope` + 每个模块的越权矩阵测试（自己 / 他人 / admin，file 多一档"未认证"）
- [x] **card / text / onto / sign / conv / reading / calendar**：标准口径（样板：card）
- [x] **task / chat**：子表随父（模板：task 的 `ensure_task_owned`；`time_window` 已在 v26 并进 `task_block`）
- [x] **bookmark**：书签标准口径；`bookmark_tag` 按自己那行判；`bookmark_tag_rel` 随父
- [x] **mem**：端口签名全线迁到 `&Actor`；`push_user_visible` 已删除（mem 是它最后一个调用方）
- [x] **file**：内容路由保留匿名访问与"公开 / 私密 × 未认证 / 他人 / admin"三态；写路径收成
      上传者与 admin（越权 404，`service::ensure_can_mutate`）—— 形状仍与其他模块不同，见 §3
- [x] 收尾项：
  - [x] **前端：非 owner 的写入口隐藏**（提交 `1269ed85`）：file 的列表项按钮 / 详情页按钮
        本来就按 `can_edit` 隐藏，这轮补掉右键菜单、行与卡片的选择框、工具栏「选择」三处；
        **界面上不显示"谁创建的"**（用户口径）—— 没加 owner 字段，也没有任何归属展示
  - [x] `AGENTS.md` 已同步：那条"匿名老文件视为公共资源"改成了"已作废，无主行只有 admin
        看得见、改得动"
  - [x] 其余模块的 UI 无需改（普通用户的列表本来就只含自己的行；admin 对所有行有写权限）
- [x] **`SearchPort` 收 `&Actor`**（提交 `703b2f93`）：admin 的全局搜索跨用户，
      测试 `admin_search_spans_users_while_regular_user_does_not` 钉住
- [x] **admin 的统计/队列口径 = 全库**（已定，非待办）：`owner_scope() = None` 让 admin 的
      mem 计数、复习队列、会话预估都按全库算 —— 这是"admin 全管"的直接推论，与 admin 的
      列表口径一致。若哪天要"只看我的"，应加一个**显式 scope 参数**（例如 `?scope=self`），
      而不是让 admin 在别处又变回普通用户

## 5. 端到端验证（2026-10-01，真实库副本上跑过）

把 178MB 的开发库**复制**一份（`/tmp`，不碰原库）后启动服务，逐条核对：

| 检查 | 结果 |
|------|------|
| v20 迁移在真实数据上 | `UPDATE articles … WHERE user_id IS NULL` → 3383 行；card/task/bookmark/chunk/articles/conv_titles/mem 认领后 NULL 全为 0；schema 20/20、外键违规 0 |
| 普通用户（qa）看卡片/任务/书签 | 全是 0（迁移前同一账号能看到**全部**） |
| 普通用户按 id 读/改/删别人的卡片 | 读 404、改 404、删 404，且行内容未变 |
| admin 读别人的卡片 | 200 |
| admin 的卡片/任务/书签/文件列表 | 26 / 8（非归档）/ 522 / 44，全量 |
| admin 的全局搜索 `费曼` | 6 条命中（conv + chat，跨用户）；同一关键词普通用户 0 条 |
| 文件四态（公开/私密 × 匿名/他人/admin） | 匿名公开 200；匿名私密 401；他人私密 404（内容与元数据都是）；admin 私密 200；列表接口匿名 401、他人只见公开（43）、admin 全量（44） |

> 冒烟用的是**副本**：真实 `brainbow.db` 事后核对仍是 `user_version = 19`、`card` 里 25 行 NULL
> 未认领（v20 会在你下次 `just dev` / 部署时作用于它）。
> 这张表是 **2026-10-01 的一次性记录**，不是"当前应该是什么"的规格；现在
> `SCHEMA_VERSION = 26`，文件那一行的口径仍成立（三处可见性实现没变）。

## 6. 容易踩的坑

- **别在 handler 里 `claims.sub` 直接拼 SQL 条件**：漏一处就是越权洞，而且编译器不会提醒。
  接 `Actor` 的意义就在于漏了会编译不过。
- **`api_key` 不参与认领，无主 key 直接拒绝**：`authenticate_api_key` 见到
  `user_id IS NULL` 就记一条 WARN 并当作"凭据无效"（最终 401），**不再映射成 `sub = -1`**
  ——v20 之后 `user_id IS NULL` 的行都归了 admin，一个"没有归属"的身份看不到任何数据，
  留着只会让人困惑。回填同样不行：那等于凭空给它一个 admin 身份。
- **admin 不是"另一个用户"**：`is_admin` 只是多一档权限，`user_id` 仍然是同一个人 ——
  写路径的 `user_id` 一律写 `actor.user_id`（别写成 NULL 或 0）。
