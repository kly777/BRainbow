# 数据库

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

## 技术选型

- SQLite，通过 sqlx 0.9（`runtime-tokio` + `sqlite` + `chrono` + `macros`）访问
- 开发/测试默认内存库（`sqlite::memory:`）或 `sqlite:brainbow.db`
- 生产数据库按根目录约定落在 `{BRAINBOW_ROOT}/data/brainbow.db`（部署为 `/opt/brb/data/brainbow.db`）
- 连接与 PRAGMA 集中在 `crates/db/src/connect.rs`：外键显式开启 + busy_timeout 3s + WAL/NORMAL

## Schema：一份声明，三处消费

结构只在 `crates/db/src/schema/` 声明一次，由三个消费者共用 —— 这是这套东西的全部设计：

| 消费者 | 入口 | 做什么 |
|--------|------|--------|
| 新库 | `schema::create_tables` | `user_version = 0` 且一张表都没有 → 顺序执行声明直建（随后建时间触发器、FTS 并 `rebuild`） |
| 老库 | `schema::apply::reconcile` | 其余一切（老库、`user_version = 0` 但有表的历史库、被删过表的库）→ **按形状**补齐 |
| 自检 | `db::verify::check_schema` | 只读比对：缺表、缺列、声明之外的列、外键违规 |

声明分文件放（`crates/db/src/schema/`）：

| 文件 | 内容 |
|------|------|
| `tables.rs` | 表与索引的 DDL 声明，**顺序即应用顺序**；带 `requires` 的索引在缺列的旧库上跳过 |
| `time.rs` | `TIME_COLUMNS` 清单 + 时间归一化触发器 `trg_<表>_time_iso_{ins,upd}`（写入即规范化为 `+00:00`） |
| `fts.rs` | `FTS_SPECS` 清单 + FTS5 虚拟表与同步触发器（trigram tokenizer） |
| `legacy.rs` | 废弃对象：要删的表 / 索引 / 列（`conv`、`media`、`task_decomposition`、`task_time_allocation`、`file_category` …） |
| `repairs.rs` | 版本化的幂等数据修复（去重、标签合并、认领无主行、PDF 正文置空重抽、v26 `time_window` → `task_block`）+ **无条件跑的时间戳规范化** |
| `rebuild.rs` | 版本化的表重建：只用于 SQLite 加不上的表级约束（目前一条，v24 的 `task`） |
| `apply.rs` | `reconcile` 的实现与声明镜像（列定义取自声明文本） |
| `mod.rs` | `SCHEMA_VERSION`（当前 **26**）+ `migrate` + `create_tables` |

应用侧的 `src/db/mod.rs` 只是 facade（`pub use brainbow_db::{connect, migrate, verify}`）；实现全在 `crates/db/`，repository 仍留在各业务模块。

按领域读表（口径是 `tables.rs` 的声明本身）：

| 领域 | 表 |
|------|----|
| 用户/认证 | `user`、`app_settings` |
| API Key | `api_key` |
| 任务 | `task`、`task_dependency`、`task_tag_rel`、`task_series`、`task_block` |
| 日历 | `calendar_event`、`calendar_event_series` |
| 知识卡片 | `card` |
| 本体/符号 | `onto`、`signifier_signified` |
| 记忆 | `chunk`、`mem`、`mem_prerequisite`、`mem_mnemonic`、`revlog`、`tag`、`mem_tag` |
| 对话 | `conv_titles`、`articles`、`chat_tree`、`chat_node`、`prompt_preset`、`ai_settings` |
| 书签 | `bookmark`、`bookmark_tag`、`bookmark_tag_rel` |
| 阅读 | `reading_article`、`reading_article_word`、`reading_user_word` |
| 文件/文本 | `file`、`file_meta`、`file_tag`、`file_tag_rel`、`text_note` |
| 全文索引 | `<表>_fts` 虚拟表 + 影子表：card / task / bookmark / onto / text_note / reading_article / conv_titles / articles / chat_node / chunk |

旧的 `time_window` 已在 v26 迁入 `task_block`（`actual` 丢弃）；`task_decomposition`、`task_time_allocation` 在 v24 删除。三者都不是现行表，读代码时别按老名字找。

## 改 schema 的流程

1. **改声明**（唯一一处）—— 加列/表就改 `tables.rs` 里那句 DDL；动时间列改 `time.rs`；
   动全文索引改 `fts.rs`
2. **`SCHEMA_VERSION += 1`**（`schema/mod.rs`）—— 老库据此跑一次 `reconcile`
3. 视情况补三类东西：
   - 删表/删列/删索引 → 登记进 `legacy.rs`
   - 要动存量数据（搬值、回填、合并）→ 在 `repairs.rs` 加一条**幂等**修复
   - 表级约束（CHECK / UNIQUE / 外键）→ 在 `rebuild.rs` 的 `REBUILDS` 登记 `(版本, 表)`，按声明重建

就这样，没有"写第二遍 DDL"这回事：新库与老库补列用的是**同一份声明文本**（老库那侧
是 `ALTER TABLE ADD COLUMN <声明里的列定义>`，文本由 SQLite 自己从声明里解析出来）。
两条纪律：**已发布条目的 DDL 文本别改写**（老库的列是照它逐字追加的，改文本会造成新旧库分叉）；
列形状一律用 `pragma_table_xinfo` 读（`table_info` 不列 VIRTUAL 生成列）。生成列
（如 `file.category`）的表达式还要在声明里登记一份（`Decl::generated`），有测试盯着两份一致。

## reconcile 的阶段顺序（每一步的次序都有理由，别随手调）

0. **表重建**（`rebuild.rs`）—— 只做声明里新增的表级约束（SQLite 的 `ALTER` 加不上）。
   在 reconcile 的**事务之外、reconcile 之前**跑：外键要在事务外关（事务内是 no-op），
   重建会带走索引/触发器，所以必须早于 ④⑤⑥ 让它们建回来
1. **废弃表/索引** —— 索引先删：可能引用着第 7 步要删的旧列，也可能与声明的新形态冲突
2. **表与列** —— 建缺表、补缺列
3. **数据修复** —— 先跑**无条件**的时间戳规范化，再跑版本门控的 `repairs`；必须早于建索引：
   唯一索引要靠去重先清干净（v17 的教训）
4. **索引** —— 缺则建，文本与声明不符则替换
5. **时间触发器** —— **必须早于 FTS 触发器**
6. **FTS** —— 虚表形状不符则整组重建并 `rebuild`；**触发器每次重铺**，让第 5 步的
   时间触发器始终排在它们前面（老库上 FTS 触发器早就在了，不重铺就会反序）
7. **声明之外的列** —— 只删登记在 `legacy.rs` 里的；不认识的列留着并告警

时间戳规范化**不受版本门控**：它的正确性依赖一份会增长的清单（`TIME_COLUMNS`），按版本
门控就意味着"清单扩了、忘了抬门槛"会静默漏掉一类列（`file.updated_at` 就是这么漏的）。
代价是几十条 UPDATE，只在版本升级时发生。

`user_version` 的语义是**schema 代次**（`schema::SCHEMA_VERSION`）：老库升级看它、
`just rollback` 判断"要不要连数据库一起回滚"也看它。库版本高于程序支持版本 → 拒绝启动。

## 不变量（都有测试盯着，别绕过）

| 不变量 | 谁盯着 | 它拦的是什么 |
|--------|--------|--------------|
| 老形状补齐 ≡ 新建库（列定义 + 对象清单） | `db::tests::reconcile_restores_pre_v18_shape_to_fresh_equivalent` | 形状对账漏了东西 |
| 升级路径 ≡ 新建库（**补进库里的列定义**） | `db::tests::upgrade_path_reproduces_column_definitions` | 补出来的列与声明不一致（删列 → reconcile → 逐列比对；清单是**推导**的，不靠人工登记） |
| 表重建保留行与子表指向、新约束生效 | `db::schema::rebuild::tests::rebuild_carries_constraints_and_keeps_rows` | 重建把数据/引用弄丢，或约束没落地 |
| 触发器创建顺序：时间归一化早于同表的 FTS | `db::tests::time_triggers_precede_fts_triggers` | 顺序反了会撞出 `database disk image is malformed` |
| 每个 TIMESTAMP 列都被时间归一化触发器覆盖 | `db::tests::time_columns_cover_every_timestamp_column` | 漏进 `TIME_COLUMNS` 的列会把默认值格式**原样落库**（`file.updated_at` 的教训） |
| 声明自洽（名字在 DDL 里、不重名、前置条件指向已声明的表、生成列表达式与 DDL 一致） | `db::schema::tests::*` | 手写声明里的低级错误 |
| 缺表 / 缺列 / 声明之外的列 | 启动自检 `db::verify::check_schema` | 漂移；**漏抬 `SCHEMA_VERSION`** 的症状就是"声明有、库里没有的列"，启动即拦下 |
| 存量数据的时间戳都是 `+00:00` 形态 | `--check` 第 6 项（`db::verify::check_timestamp_formats`） | 触发器漏了、或绕过应用直接写库 |

**为什么时间列必须进 `TIME_COLUMNS`**：老库的**列默认值**改不掉（SQLite 不能改列定义），
历史上基线写过 `CURRENT_TIMESTAMP`（空格分隔、无时区）/ `…Z` / `…+00:00` 三种形态，
所以老库与新库的默认值天然不同。这无害**当且仅当**写入时会被触发器改写成规范格式 ——
一旦某列没有触发器兜底，走默认值的插入就会把那种格式直接落库。新写 `updated_at` 时也别再写
`= CURRENT_TIMESTAMP`，用 `strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')` 或 `time_text::utc_now_iso()`。

## SQLite 表达不了的变更

`reconcile` 只做加列与删列；改列类型 / 改默认值 / 加约束 / 改名都要重建表。

**表级约束已经有路径**：`rebuild.rs` 的 `REBUILDS` 按版本登记要重建的表（目前 v24 的
`task`，新增了两条 CHECK），重建时：

- 在 **reconcile 事务外**先 `PRAGMA foreign_keys = OFF`（事务内是 no-op），无论成败都开回来
- `CREATE TABLE __rebuild_<表>`（声明的 DDL 换个名字）→ 只搬**两边都有的列** → `DROP TABLE` → `RENAME`
- 提交前 `PRAGMA foreign_key_check` 必须干净，脏了上抛 → 事务回滚 → 表原样还在

**改名 / 改类型 / 改默认值**至今没用到过；真要做时写一条显式修复，并记住上面两个坑
（关外键在事务外、`DROP TABLE` 开着外键会把子表行级联删掉）。

## `--check` 与自检

`brainbow --check`（只读：不迁移、不建目录、不删文件）跑深检查，六项：

| 项 | 内容 | 跑在哪 | 失败后果 |
|---|---|---|---|
| 1 | schema：`user_version`、表与列对照**声明**（列镜像在内存库里照声明建一遍）、`PRAGMA foreign_key_check` | 启动 + `--check` | 致命（声明之外的列只报） |
| 2 | `PRAGMA quick_check` 全库逐页扫描 | 仅 `--check` | 致命（`is_fatal`） |
| 3 | 上传目录存在性与可写性 | 启动 + `--check` | 致命 |
| 4 | 存储一致性（缺失/孤儿/大小/分类） | 启动 + `--check` | 只告警 |
| 5 | 缩略图缓存目录 | 启动 + `--check` | 只告警 |
| 6 | 时间戳格式：所有 TIMESTAMP 列里非 `+00:00` 的行数 | 仅 `--check` | 不致命，但进 `is_clean` |

- 退出码由 `is_clean` 决定；`--check` 不干净 → 非零退出（部署收尾的自动自检据此报告，
  部署侧只告警不回滚）
- 第 6 项扫的列是从 `sqlite_master` 里 `upper(type) LIKE '%TIMESTAMP%'` **推导**的（不读
  `TIME_COLUMNS`），所以清单漏登记也能被它扫出来；逐列 `COUNT(*)` 合成一条 UNION ALL，一次往返
- 本地复跑：`just check-backend`（直接用开发库）；服务器上 `./brainbow --check`
- 第 1 项也是"**漏抬 `SCHEMA_VERSION`**"的兜底：声明改了、版本没动 → 老库不补齐 → 启动报"缺失列"

## 真库副本演练

迁移/reconcile 的改动不能只靠内存库的合成形状验收 —— 真库有数据量与历史形状。
拿副本跑一遍，前后各 dump 一份对照：

```bash
cp brainbow.db target/rehearsal.db        # 先复制，别碰真库
BRAINBOW_FIXTURE_DB=target/rehearsal.db \
  cargo test -p brainbow-db migrate_fixture_db -- --ignored --nocapture
sqlite3 target/rehearsal.db 'PRAGMA user_version;'
```

对照项：`pragma_table_xinfo` 的列定义、`sqlite_master` 的对象清单、逐表行数、
以及数据事实（认领 / 时间戳 / 标签）。

**SQLite 的 `-wal` 陷阱**：换库文件前不连 `-wal`/`-shm` 一起删，陈旧 WAL 会被拼进新库
（`cp` 出来的库 salt 相同，SQLite 的校验拦不住；实测拿到过一个"迁移完成 0.01s"的假象）。
`prepare_schema_fixture` 与 `migrate_fixture_db` 都在收尾 `close()` 连接，避免把 `-wal` 留下来。

## sqlx 离线数据

- `.sqlx/query-*.json` 是 sqlx 编译期宏的 schema 快照，**文件数量 = 当前宏数量**
- `just sqlx-prepare`（`cargo xtask sqlx-prepare`，实现在 `xtask/src/devel.rs`）：
  1. 删掉 `target/sqlx-prepare.db` 并**连 `-wal`/`-shm` 一起删**
  2. `cargo test prepare_schema_fixture -- --ignored`：用**迁移器**在全新 fixture 库上跑到最新 schema
     （直接拿开发库生成会拿到历史 schema）
  3. `DATABASE_URL=sqlite:target/sqlx-prepare.db cargo sqlx prepare`
- 本地编译是在线校验：`.cargo/config.toml` 的 `[env]` 设了 `SQLX_OFFLINE=false` +
  `DATABASE_URL=sqlite:brainbow.db`。正确顺序是**先让库迁移 → 再写引用新列的 SQL → 再
  `just sqlx-prepare`**；反了会卡死（新 SQL 编译不过 → 跑不了迁移 → 库还是旧 schema），
  应急可用 `SQLX_OFFLINE=true` 走离线快照
- release/部署构建是另一条路：`xtask/src/build.rs` 显式 `SQLX_OFFLINE=true` 并摘掉
  `DATABASE_URL`（只 `env -u` 不够，`[env]` 会注回去），要么用已提交的快照，要么响亮失败
- SQL 变更后必须重跑并提交 `.sqlx/`

## 注意事项

- 模块禁止自行建表
- 外键/级联删除在 schema 中声明；删除逻辑依赖外键时要先确认 SQLite `PRAGMA foreign_keys` 行为
- 备份用 sqlite3 `.backup` 或服务停止后 `cp`（记得 `-wal`/`-shm`）
- 补齐/修复失败必须上抛导致启动失败，**禁止静默吞错**
