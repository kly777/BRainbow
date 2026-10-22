# 记忆模块 — 设计方案

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 基于 FSRS 的间隔重复记忆系统。管理"记忆项"（cue → target 配对），通过分级复习调度实现长期 retention。
> 时间列统一为 `%Y-%m-%dT%H:%M:%S+00:00`（UTC，不用 `Z`），由 `crates/db/src/schema/time.rs` 的 `TIME_COLUMNS` 与 `trg_<表>_time_iso_{ins,upd}` 触发器归一。

---

## 1. 核心概念

### 1.1 Chunk（知识块）

最小的内容单元，存储 Markdown 文本。每个记忆项包含两个 Chunk。

```sql
CREATE TABLE chunk (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL DEFAULT '',              -- Markdown 正文
    user_id    INTEGER,                                -- 归属（shared/actor.rs 判据；NULL = 历史无主行）
    created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    updated_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now'))
);
```

全文检索走 FTS5 虚表 `chunk_fts`（`content` 列，触发器维护），见 `crates/db/src/schema/fts.rs`。

### 1.2 Mem（记忆项）

一对 cue→target 的关联，附带 FSRS 调度参数。

```sql
CREATE TABLE mem (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,

    cue_chunk_id    INTEGER NOT NULL,                         -- 提示（问题）
    target_chunk_id INTEGER NOT NULL,                         -- 目标（答案）
    user_id         INTEGER,                                  -- 归属（NULL = 历史无主行）

    state           TEXT NOT NULL DEFAULT 'new',              -- new/learning/review/relearning/suspended
    stability       REAL DEFAULT 0,                           -- FSRS 稳定性（天；crate 的 MemoryState 单位）
    difficulty      REAL DEFAULT 0,                           -- FSRS 难度
    step_index      INTEGER,                                  -- 步进索引
    buried          INTEGER NOT NULL DEFAULT 0,               -- 是否被埋藏
    lapses          INTEGER NOT NULL DEFAULT 0,               -- 遗忘次数（Again +1；Good/Easy 推进时清零）
    leeched         INTEGER NOT NULL DEFAULT 0,               -- 是否被标记为"吸血鬼卡"（lapses ≥ 5 后置位且不再回退）
    in_pool         INTEGER NOT NULL DEFAULT 0,               -- 历史列：main 代码未读写
    due_at          TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),  -- 下次复习时间
    last_review_at  TIMESTAMP,                                -- 上次复习时间
    created_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    FOREIGN KEY (cue_chunk_id)    REFERENCES chunk(id),
    FOREIGN KEY (target_chunk_id) REFERENCES chunk(id)
);
```

### 1.3 MemPrerequisite（前置依赖）

一个记忆项可以依赖其他记忆项作为先决条件。

```sql
CREATE TABLE mem_prerequisite (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    mem_id           INTEGER NOT NULL,                -- 后置卡
    requires_mem_id  INTEGER NOT NULL,                -- 前置卡
    FOREIGN KEY (mem_id)          REFERENCES mem(id),
    FOREIGN KEY (requires_mem_id) REFERENCES mem(id),
    UNIQUE(mem_id, requires_mem_id)
);
```

**行为语义**：如果前置卡的状态为 `new`，后置卡不会出现在学习池中。这保证了先学基础概念再学进阶内容。

### 1.4 Revlog（复习日志）

每次复习在同一个事务里写一条 `revlog`，供 FSRS 参数优化与统计使用：

```sql
CREATE TABLE revlog (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    mem_id            INTEGER NOT NULL,
    review_time       TEXT NOT NULL,          -- 列声明是 TEXT；仍在 TIME_COLUMNS 里，由触发器归一为 +00:00
    rating            INTEGER NOT NULL,       -- 1..=4
    delta_t           INTEGER NOT NULL,       -- 距上次复习的天数
    stability_before  REAL,
    difficulty_before REAL,
    state_before      TEXT,
    stability_after   REAL,
    difficulty_after  REAL,
    state_after       TEXT,
    duration_secs     REAL,                   -- 看这张卡的秒数（0/缺省 = 未上报）
    FOREIGN KEY (mem_id) REFERENCES mem(id)
);
CREATE INDEX idx_revlog_mem_id ON revlog(mem_id);
```

### 1.5 标签与助记

```sql
CREATE TABLE mem_mnemonic (          -- AI 助记；随 mem 级联删除
    mem_id     INTEGER PRIMARY KEY,
    content    TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE
);

CREATE TABLE tag (                   -- tag 表由 task 与 mem 共用；按用户隔离
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    user_id    INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    FOREIGN KEY (user_id) REFERENCES user(id),
    UNIQUE(name, user_id)
);

CREATE TABLE mem_tag (               -- 标签关联；随 mem/tag 级联
    mem_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (mem_id, tag_id),
    FOREIGN KEY (mem_id) REFERENCES mem(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tag(id) ON DELETE CASCADE
);
```

---

## 2. 卡状态机

```
          创建
            │
            ▼
         ┌──────┐
    ┌────│ NEW  │────┐
    │    └──────┘    │
    │ 首次复习       │
    ▼                │
 ┌──────────┐        │
 │ LEARNING │        │  步进：[1min, 10min]
 └─────┬────┘        │
  步进完成│           │
        ▼             │
   ┌────────┐         │
   │ REVIEW │         │  复习正常到期
   └───┬────┘         │
   遗忘 │              │
       ▼              │
  ┌───────────┐       │
  │ RELEARNING│       │  步进：[10min]
  └─────┬─────┘       │
   步进完成│            │
        └─────────────┘

又回到 REVIEW
  （重置：REVIEW → NEW）
```

### 2.1 状态字段

| 状态 | 含义 | 步进 | 行为 |
|------|------|------|------|
| `new` | 新卡，未被复习过 | 无 | 被 `GET /mem/due` 取到时就地写为 `learning` + `step_index=0` |
| `learning` | 学习中，处于初始步进阶段 | 默认 [1min, 10min] | 步进内 Again 回退到 step=0；Hard 留在当前步 |
| `review` | 已掌握，按 FSRS 间隔调度 | — | 按 stability/difficulty 动态排期 |
| `relearning` | 复习时忘记，进入重学步进 | 默认 [10min] | 步进走完后 Good/Easy 回 `review`；提前点 Good/Easy 会被服务层留在 Relearning |
| `suspended` | 手动挂起 | — | 不进入任何学习池；`unsuspend` 会重置回 `new`（S/D/lapses/leeched 清零） |

### 2.2 步进机制

学习步进和重学步进来自持久化配置 `MemConfig`（`app_settings` 的 `mem_config` 键，启动时读入 `AppState`；默认 `learning_steps=[60, 600]`、`relearn_steps=[600]`、`graduating_interval_secs=7200`、`desired_retention=0.9`）。main 没有修改步进/retention 的公开 API，只有 FSRS 参数优化器会写回 `fsrs_params`。

- **Learning steps**（默认 [60s, 600s]）
  - rating=1 (Again)：回到 step 0，due 取 `learning_steps[0]`（60s）；同时用 FSRS rating=1 更新 S/D（`compute_next_with_state`）
  - rating=2 (Hard)：留在当前 step，due 取当前 step 的间隔；S/D 保持不变
  - rating=3/4 (Good/Easy)：推进到下一步；未到末尾时 **不调 FSRS**，S/D 保持不变。到末尾时毕业到 `review`：用 `cumulative_step_days.max(1)` 调 FSRS 得到 S/D 与间隔，再取 `max(FSRS 间隔, graduating_interval_secs)`（实际毕业间隔至少 1 天）
- **Relearning steps**（默认 [600s]）
  - Again：用 FSRS rating=1 更新 S/D，due 取 `relearn_steps[0]`
  - Hard：留在当前 step，S/D 不变
  - Good/Easy：步进未走完时由 `relearn_min_step_remaining` 拦住（服务层把卡留在 `relearning`，due 设为剩余秒数）；走完后与 learning 毕业同规则（`cumulative_step_days.max(1)` + 最小毕业间隔）

---

## 3. FSRS 调度（`src/modules/mem/fsrs/mod.rs`）

### 3.1 依赖

使用 `fsrs` crate **6.6.1**（`Cargo.toml`），即 FSRS-6：crate 的 `DEFAULT_PARAMETERS` 是 **21 个 f32**，最后一个（索引 20）是 decay，默认 `FSRS6_DEFAULT_DECAY = 0.1542`。`MemConfig.fsrs_params` 为空时用 crate 默认参数；优化器成功后写回的就是 `compute_parameters` 返回的参数向量。

### 3.2 核心调度函数

```rust
schedule(
    ScheduleInput { s_old, d_old, state, step_index, rating, days_elapsed, cumulative_step_days },
    &SchedulerConfig,
) -> Result<ReviewOutcome, String>
```

**参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `s_old` / `d_old` | f64 | 当前 stability / difficulty |
| `state` | CardState | `new` / `learning` / `review` / `relearning` / `suspended` |
| `step_index` | Option\<usize\> | 当前步进索引 |
| `rating` | u8 | 1=again, 2=hard, 3=good, 4=easy（handler 已校验 1..=4） |
| `days_elapsed` | u32 | 距上次复习的整天数；步进阶段传 0 |
| `cumulative_step_days` | u32 | 名义上是从进入步进阶段起累计的天数；当前 `MemService::apply_review` 实际传 `days_elapsed`，毕业时 `.max(1)` |
| `SchedulerConfig` | &SchedulerConfig | `learning_steps` / `relearn_steps` / `graduating_interval_secs` / `desired_retention` / `fsrs_params`，由 `MemConfig` 逐次显式传入 |

**返回值**：`ReviewOutcome { state, stability, difficulty, due_at }`，`due_at` 已按 `%Y-%m-%dT%H:%M:%S+00:00` 格式化。`suspended` 进入调度时原样返回、`due_at` 取当前时间（安全兜底）。

> 注：`MemService::apply_review` 目前把 `cumulative_step_days` 赋成 `days_elapsed_since(last_review_at)`（不是从进入步进阶段起累计）；步进内通常为 0，毕业时 `.max(1)` 按 1 天算。

### 3.3 四级评分体系

| 评分 | 键盘快捷键 | 含义 | 效果 |
|------|-----------|------|------|
| 1 (Again) | `1` | 完全忘记了 | `review` → `relearning`；learning/relearning 回 step 0；S/D 用 FSRS rating=1 更新；`lapses+1` |
| 2 (Hard) | `2` | 想起来了但很困难 | learning/relearning：留在当前步，S/D 不变；`review`：用 FSRS hard interval 排期 |
| 3 (Good) | `3` | 正常回忆 | 推进步进；末步毕业（FSRS good interval）；`review`：FSRS good interval |
| 4 (Easy) | `4` | 非常轻松 | 同 Good，末步/复习用 FSRS easy interval |

> 实现注记：`MemService::apply_review` 的 `new_step` 对 rating=2 也会写 `step_index = s+1`（`due_at` 仍取当前步），与"Hard 留在当前步"的意图不完全一致；当前实际行为以代码为准。

### 3.4 预览（`preview`）

```rust
preview(s_old, d_old, state, step_index, days_elapsed, elapsed_secs, &SchedulerConfig) -> Result<[f64; 4], String>
//                                                                                 [again, hard, good, easy]（秒）
```

返回值单位是**秒**，供前端按钮展示。语义随状态不同：

| 状态 | again | hard | good / easy |
|------|-------|------|-------------|
| `new` / `learning` | `learning_steps[0]` | 当前 step 的间隔 | 未到末步：下一步间隔；末步：FSRS 毕业间隔（≥1 天） |
| `review` | `learning_steps[0]`（不是 FSRS again） | FSRS hard | FSRS good / FSRS easy |
| `relearning` | `relearn_steps[0]` | 当前重学步进 | 步进未走完：剩余等待秒数；走完：FSRS 毕业间隔 |
| `suspended` | 0 | 0 | 0 |

---

## 4. 学习池调度（`service.rs`）

### 4.1 `get_due` 调度策略

`GET /mem/due` 归在**写路由**（它会推进新卡状态），按优先级填满 `limit`（handler 缺省 7）：

```
1. 到期的 Learning/Relearning   state IN ('learning','relearning') AND due_at <= now，按 due_at 升序
2. 到期的 Review                state='review' AND due_at <= now，按难度/遗忘/过期程度加权采样
3. 新卡                         state='new'，ORDER BY RANDOM()；取出后就地写为 learning + step_index=0
4. 提前复习（upcoming）          state='review' AND due_at > now，同样加权采样
5. 兜底                         队列仍为空时取一张未来的 review 卡
```

加权采样在 `selection.rs`：权重 = 遗忘紧迫度（`retrievability` 低更高）× 难度（`difficulty` > 5 后增益）× 失败次数（`lapses`，最多计 8）× 过期天数（封顶 30 天）；算法是 Efraimidis–Spirakis 不放回加权采样。

响应字段：`due_count` 是**本次返回的条数**（不是库里到期总数）；`has_more` 表示还有学习卡没放进本轮或已填满 `limit`；`upcoming_count` 只在队列为空时统计；`all_far` 表示返回的卡全部在 24 小时之后到期。

### 4.2 前置依赖过滤

所有学习池查询（learning / due review / new / upcoming）都排除"前置卡尚未完成"的卡片，并同时要求 `buried = 0`、`state != 'suspended'`：

```sql
NOT EXISTS (
  SELECT 1 FROM mem_prerequisite mp
  JOIN mem pm ON mp.requires_mem_id = pm.id
  WHERE mp.mem_id = m.id AND pm.state = 'new'
)
```

### 4.3 埋葬（Bury）与挂起（Suspend）

- **Bury**：把 `buried` 置 1，所有学习池查询都带 `buried = 0`，因此不再出现；`unbury` 置回 0。
- **Suspend**：把 `state` 写成 `suspended`，同样不进入任何池；`unsuspend` 会重置为 `new`（S/D/step/lapses/leeched 清零，due 取当前时间），不会恢复挂起前的进度。

### 4.4 吸血鬼卡（Leech）

`leeched = row.leeched || lapses >= 5`：一旦置位就不再回退；目前不自动暂停/阻止复习，只做标记，未来可扩展弹窗提示。`lapses` 在 `rating=1` 时 +1；`rating=2` 或仍留在 `relearning` 时不变；其余 Good/Easy（包括 learning 内推进）都会清零。

---

## 5. API 接口

### 5.1 路由注册

记忆模块挂在**认证组**（`src/app/http/routes/api.rs` 的 `authed.nest("/mem", mem::routes::<AppState>())`），所有 handler 都取 `Extension<Actor>` 做归属过滤：普通用户只看到/改到自己创建的行，admin 绑 `NULL` 不过滤。`mod.rs` 按读/写拆成两个 Router（`GET /mem/due` 因会推进新卡状态归写侧）：

```rust
// 读（MemQueryService，无副作用）
GET    /mem/all                分页列表（q/state/sort/order/tag_ids/exclude_tag_ids/id/page/page_size）
GET    /mem/counts             返回 new/learning/due/buried/suspended 计数
GET    /mem/session-estimate   本次学习预估（due_count/retention/total_estimate/avg_seconds）
GET    /mem/upcoming-counts    返回 within_8h / within_24h
GET    /mem/export/csv         导出 PSV/CSV 文本（响应 Content-Type: text/tab-separated-values）
GET    /mem/{id}/preview       四个评分对应的间隔（秒）
GET    /mem/{id}/mnemonic      读 AI 助记
GET    /mem/tag/list           标签列表
GET    /mem/tag/search?q=      标签搜索
GET    /mem/tag/mem/{id}       某条记忆的标签
POST   /mem/tag/batch-by-ids   批量取 mem 的标签

// 写（MemService / DbMemMaintenance，有副作用）
POST   /mem                     创建（cue_content / target_content / prerequisites）
GET    /mem/due?limit=&tag_ids=&exclude_tag_ids=   取学习池（会推进新卡状态）
PUT    /mem/{id}/edit           编辑 cue/target 内容
POST   /mem/{id}/review         提交评分（rating 1..=4；duration_secs 0..=86400）
POST   /mem/{id}/undo           撤销上次复习（客户端带旧状态）
POST   /mem/{id}/bury           埋葬
POST   /mem/{id}/unbury         取消埋葬
POST   /mem/{id}/suspend        挂起
POST   /mem/{id}/unsuspend      取消挂起（重置为 new）
POST   /mem/{id}/reset          重置为 new
PUT    /mem/{id}/mnemonic       写 AI 助记
DELETE /mem/{id}                删除记忆项
POST   /mem/optimize            立即跑 FSRS 参数优化
POST   /mem/batch-bury          批量埋葬
POST   /mem/batch-delete        批量删除
POST   /mem/batch-reset         批量重置
POST   /mem/tag/create          创建标签
DELETE /mem/tag/delete/{id}     删除标签
POST   /mem/tag/mem/add         给记忆加标签
POST   /mem/tag/mem/remove      移除标签
POST   /mem/tag/mem/set         覆盖标签集合
POST   /mem/tag/batch-add       批量加标签
POST   /mem/tag/batch-remove    批量移除标签
POST   /mem/tag/batch-set       批量覆盖标签
POST   /mem/import/csv          CSV 导入
POST   /mem/import/psv          PSV 导入
POST   /mem/import/json         JSON 导入
```

### 5.2 接口详情

#### POST `/mem`

创建记忆项。

```json
// Request
{
  "cue_content": "什么是 FSRS？",
  "target_content": "Free Spaced Repetition Scheduler，一种基于记忆稳定性的调度算法",
  "prerequisites": [1, 2]
}
// Response
{ "id": 42 }
```

#### GET `/mem/due?limit=20`

获取待复习队列。`items` 的字段来自 `MemWithChunks`（`model.rs`）：`cue`/`target` 各带 `id/content/created_at/updated_at`，另有 `state`、`stability`、`difficulty`、`due_at`、`lapses`、`leeched`、`mnemonic`。时间均为 `%Y-%m-%dT%H:%M:%S+00:00`。

```json
// Response（due_count 是本次返回条数；upcoming_count 只在队列为空时统计）
{
  "items": [
    {
      "id": 42,
      "cue": { "id": 1, "content": "...", "created_at": "2026-07-01T09:00:00+00:00", "updated_at": "2026-07-01T09:00:00+00:00" },
      "target": { "id": 2, "content": "...", "created_at": "2026-07-01T09:00:00+00:00", "updated_at": "2026-07-01T09:00:00+00:00" },
      "state": "learning",
      "stability": 0.0,
      "difficulty": 0.0,
      "due_at": "2026-07-04T12:00:00+00:00",
      "lapses": 0,
      "leeched": false,
      "mnemonic": null
    }
  ],
  "due_count": 1,
  "has_more": true,
  "upcoming_count": 0,
  "all_far": false
}
```

#### POST `/mem/{id}/review`

提交复习评分。`duration_secs` 可省略（0），服务端拒绝 NaN/负数/超过 86400；`rating` 不在 1..=4 直接 400。写入在单事务内完成（`review_mem_atomic`）：`stability` 与 `last_review_at` 作乐观锁，并发复习后到者拿到 409 `CONFLICT`，不会静默覆盖。

```json
// Request
{ "rating": 3, "duration_secs": 12.5 }
// Response
{
  "state": "review",
  "due_at": "2026-07-05T12:00:00+00:00"
}
```

#### POST `/mem/{id}/undo`

撤销上次复习：客户端把复习前的完整状态发回来，服务端直接覆盖（不做历史回溯）。注意 `last_review_at` 不在请求里 —— `update_mem_fsrs` 会把它写成当前时间，所以撤销后 `days_elapsed` 从撤销时刻重新起算。

```json
// Request
{
  "state": "review",
  "stability": 12345.6,
  "difficulty": 5.0,
  "step_index": null,
  "lapses": 0,
  "leeched": false,
  "due_at": "2026-07-04T12:00:00+00:00"
}
```

#### GET `/mem/{id}/preview`

返回 `{ "intervals": [f64; 4] }`，单位秒，顺序 `[again, hard, good, easy]`；各状态下的取值语义见 §3.4。

#### PUT `/mem/{id}/edit`

编辑 cue/target 内容，不重置调度参数。

```json
// Request
{
  "cue_content": "新的提示内容",
  "target_content": "新的目标内容"
}
```

#### POST `/mem/{id}/bury` / `unbury` / `suspend` / `unsuspend` / `reset`

均返回 `{ "ok": true }`。

#### DELETE `/mem/{id}`

在一个事务里删除：`revlog` → `mem_prerequisite`（`mem_id` 与 `requires_mem_id` 两个方向）→ `mem` 行，然后清理不再被任何 mem 引用的 `tag` 与孤儿 `chunk`。`mem_tag` / `mem_mnemonic` 由外键 `ON DELETE CASCADE` 跟着删。

---

## 6. 架构分层

```
src/modules/mem/
├── mod.rs                路由注册（read_routes / write_routes / tag_* / import_*）
├── model.rs              领域模型（Chunk / MemWithChunks / MemRow / FsrsUpdate / InsertRevlogParams …）
├── dto.rs                HTTP 契约 DTO（CreateMemRequest / ReviewRequest / MemQuery / MemCounts / SessionEstimate …）
├── handler.rs            Axum handlers（参数校验、响应序列化）
├── service.rs            写侧业务（get_due、review、CRUD、标签、导入、助记）
├── query.rs              只读查询（列表、计数、session-estimate、preview、标签、导出、全局搜索）
├── port.rs               MemRepository / MemMaintenance 端口
├── repository/
│   ├── mod.rs            MemRepo 类型与行映射
│   └── mem_impl/         trait_impl.rs（全部 SQL）+ chunk.rs / fsrs.rs / tag.rs / helpers.rs
├── fsrs/                 FSRS 调度（纯函数）：mod.rs + tests.rs
├── config.rs             MemConfig（步进 / 毕业间隔 / desired_retention / fsrs_params）
├── config_repository.rs  MemConfig 持久化（app_settings 的 mem_config 键）
├── maintenance.rs        MemMaintenance 的 SQLite adapter（自动/手动优化 + revlog 修剪）
├── optimizer.rs          FSRS 参数优化（fsrs::compute_parameters）
└── selection.rs          复习候选加权采样
```

### 6.1 职责边界

| 层 | 职责 | 不做什么 |
|----|------|---------|
| `handler.rs` | 参数提取、响应序列化、错误转换 | 不包含业务逻辑 |
| `service.rs` | 写侧业务：学习池推进、复习事务编排、前置依赖、CRUD/标签/导入 | 不直接操作数据库 |
| `query.rs` | 只读聚合：列表/计数/session-estimate/preview/导出/搜索 | 不修改状态 |
| `repository/` | SQL 查询、CRUD、事务、乐观锁（`review_mem_atomic`） | 不包含调度算法 |
| `fsrs/` | FSRS 算法、步进逻辑、预览计算 | 纯函数，无 I/O，无状态 |
| `config.rs` / `config_repository.rs` | 调度配置模型与 `app_settings` 持久化 | 不参与单次调度决策 |
| `maintenance.rs` / `optimizer.rs` | 后台/手动参数优化、revlog 修剪 | 不进入 HTTP 请求的同步路径（除 `/mem/optimize`） |
| `selection.rs` | 同轮复习候选的加权采样 | 不管跨轮间隔（FSRS 负责） |

### 6.2 前端 API（`web/src/domains/mem/`）

`api.ts` 是入口，re-export `api-mem.ts` / `api-tags.ts` / `api-import.ts`：

```typescript
// api-mem.ts
createMemE(cueMd, targetMd, prerequisites?) → { id }
getAllMemsE(params?) → PaginatedResponse<MemItem>
getDueE(limit?, tagIds?, excludeIds?) → DueResponse
getMemCountsE() → MemCounts
getSessionEstimateE(params?) → SessionEstimate
reviewMemE(id, rating, durationSecs?) → { ok }
undoReviewE(id, undoData) → { ok }
previewMemE(id) → { intervals }
deleteMemE(id) / buryMemE(id) / unburyMemE(id) / suspendMemE(id) / unsuspendMemE(id) / resetMemE(id) → { ok }
batchBuryMemE(ids) / batchDeleteMemE(ids) / batchResetMemE(ids) → BatchResponse
editMemE(id, cue, target) → { ok }

// api.ts（助记 / upcoming）
getMnemonicE(memId) → { content: string | null }
setMnemonicE(memId, content) → { ok }
getUpcomingCountsE() → { within_8h, within_24h }

// api-tags.ts
createTagE(name) / deleteTagE(id) / listTagsE() / searchTagsE(q) / getMemTagsE(memId)
addTagToMemE(memId, tagId) / removeTagFromMemE(memId, tagId) / setMemTagsE(memId, tagIds)
batchAddTagToMemsE / batchRemoveTagFromMemsE / batchSetTagsForMemsE / batchGetMemsTagsE

// api-import.ts
downloadExportCsv(tagIds?) / importCsvE(csv, defaultTags?) / importPsvE(...) / importJsonE(...)
```

---

## 7. 设计决策

### 7.1 路由与多用户隔离

早期为简化开发，`/mem` 曾注册在公共路由下；main 上已经迁到认证组（`app/http/routes/api.rs` 的 `authed`），并做按用户归属：`mem.user_id` / `chunk.user_id` / `tag.user_id` 记录归属，handler 一律取 `Actor`，SQL 用 `(?N IS NULL OR user_id = ?N)`（admin 绑 NULL 即全量，普通用户只看自己的）；无 `user_id` 的子表（`revlog` / `mem_mnemonic` / `mem_tag` / `mem_prerequisite`）随父表 `EXISTS` 判断，越权一律按"不存在"（404/0 行）。

### 7.2 为什么 Chunk 独立成表？

设计上是为未来"内容复用"预留的 —— cue 和 target 未来可能被多个记忆项共享，或与其他模块（如 card、note）共享内容。

### 7.3 为什么不是纯 FSRS？

引入步进（steps）是为了**学习阶段的短间隔巩固体验**。纯 FSRS 在首次学习后直接跳到较长的间隔，不符合"刚学完需要高频重温"的教学直觉。步进+FSRS 混合策略：

- 步进阶段：固定间隔，快速巩固
- review 阶段：FSRS 接管，动态调度

### 7.4 Lapses 计数逻辑

| rating | lapses 变化 |
|--------|-------------|
| 1 (Again) | `lapses + 1` |
| 2 (Hard) | 不变 |
| 3-4 (Good/Easy) | `lapses = 0`；只有仍留在 `relearning`（提前 Good 被最低步进保护拦下）时保留原值 |

为什么？rating=1 代表真实遗忘，rating=2 是生疏但没忘；rating=3/4 是成功回忆，学习阶段的推进也算，所以会清零。例外是重学步进还没走完就点 Good/Easy —— 这时卡仍留在 `relearning`，不算通过。

### 7.5 撤销（Undo）的设计

Undo 接收完整的旧状态参数由客户端提供，服务端不做状态回溯。设计原因是：
- 服务端不维护状态历史（无 event sourcing）
- 客户端在提交 review 前已保存旧状态
- 减少存储和实现复杂度

---

### 7.6 revlog 归档策略

revlog 表存储所有复习记录，供 FSRS 参数优化和 retention 统计使用。
随着时间推移，revlog 会不断增长。为控制数据量，采用**定量封顶**策略：

| 参数 | 值 | 理由 |
|------|-----|------|
| `MAX_REVLOGS` | 2000 | 存储约 1-2 个月的日常复习数据 |
| `TARGET_REVLOGS` | 1600 | 80% 水位线，避免频繁触发删除 |

**触发时机**：每次复习后 `maintenance.schedule_auto_optimize` 起一个后台任务；`maybe_auto_optimize` 在 `revlog` 总数 ≥10 且是 20 的倍数时跑一次优化，**优化尝试结束后无论是否产出参数都会调用 `prune_revlogs`**。计数是全局的（跨用户训练，`count_revlogs` 不带归属）。

**行为**：
1. 检查 `SELECT COUNT(*) FROM revlog`
2. 若 ≤2000 → 跳过
3. 若 >2000 → 按 `id ASC` 删除最旧的 `count - 1600` 条记录

**为什么不全局删除最旧 N 条会破坏 FSRS？**
FSRS 优化器按 mem_id 分组读 revlog，每组内每条记录的 `delta_t` 是相邻两次复习的时间差。
删除某 mem 最老的几条记录后，剩余记录的 `delta_t` 值不变（它们是独立存储的），
序列仍然合法——只是该 mem 的历史变短了。这不会导致算法出错，只是优化精度略有下降。

---

## 8. 依赖

```toml
# Cargo.toml 中相关依赖
fsrs = "6.6.1"         # FSRS-6 调度 + compute_parameters（默认 21 个参数）
chrono = { version = "0.4", features = ["serde"] }  # 时间计算
sqlx = { version = "0.9.0", features = ["runtime-tokio", "sqlite", "chrono", "macros"] }
rand = "0.10"          # selection.rs 的加权采样
csv = "1.3"            # CSV / PSV 导入导出
```

---

## 9. 未来方向

- [x] revlog 归档策略（定量封顶 2000 条，超出修剪）
- [x] 多用户隔离（`mem.user_id` / `chunk.user_id` / `tag.user_id` + `Actor`；`/mem` 已挂认证组）
- [x] 按标签/知识点筛选复习池（`tag_ids` / `exclude_tag_ids`）
- [x] 批量导入/导出（CSV / PSV / JSON；Anki 格式互转仍未做）
- [ ] 学习统计看板（已有 `counts` / `session-estimate` / `upcoming-counts` 与 `revlog`，尚无独立看板页面）
- [ ] `desired_retention` / 步进 / 毕业间隔的前端配置入口（`MemConfig` 已持久化，但没有修改它的公开 API）
- [ ] Chunk 内容跨记忆项共享
- [ ] Leech 卡自动弹窗提示是否重新学习
