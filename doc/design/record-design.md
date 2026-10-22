# 记录模块 — 设计方案

> 状态：草稿（未实现） · 最后核对：2026-10-22
>
> **未实现**：`src/modules/` 与 `web/src/domains/` 里都没有 record / plan 模块（也没有对应表）；
> 本文是设计意图，**别当现状读**。要落地时先与 `task` / [`archive/task-system.md`](./archive/task-system.md) 对齐边界。
>
> 记录"已发生"的事情。task 是将来要做，record 是已经做了。

---

## 1. 数据模型

### 1.1 结构概览

```
record (基表 — 共享字段)
├── diary_entry          — 日记
├── finance_transaction  — 财务流水
├── time_log             — 时间记录
├── possession           — 物品管理
└── (task 完成记录)       — 仅基表，无特化表
```

每条具体记录在 `record` 中有一条基础行，在对应的特化表中恰好有一条扩展行，通过 `record_id` 一一对应。`kind='task'` 的记录只有基表数据。

### 1.2 基表 `record`

```sql
CREATE TABLE record (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,

    -- 记录类型
    kind        TEXT NOT NULL CHECK(kind IN (
                    'diary', 'finance', 'time', 'possession', 'task'
                )),
    -- ↑ task: 任务快速完成记录（无 plan 时）

    -- 共享字段
    title       TEXT,                 -- 日记标题、物品名、用途描述、task 标题
    content     TEXT,                 -- 正文/备注/完成笔记
    tags        TEXT,                 -- 已废弃，改为 record_tag 表（见 1.7）

    -- 时间
    occurred_at TEXT NOT NULL,        -- 发生日期 (YYYY-MM-DD)
    -- time_log 记录的 occurred_at 由 start_time 自动提取，不由用户填写

    -- 关联
    project_id  INTEGER REFERENCES task(id),  -- 所属项目
    user_id     INTEGER REFERENCES user(id),

    -- 元数据
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_record_kind       ON record(kind);
CREATE INDEX idx_record_occurred   ON record(occurred_at);
CREATE INDEX idx_record_project    ON record(project_id);
CREATE INDEX idx_record_user_kind  ON record(user_id, kind);
```

### 1.3 日记 `diary_entry`

```sql
CREATE TABLE diary_entry (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER NOT NULL UNIQUE REFERENCES record(id) ON DELETE CASCADE,

    mood        INTEGER CHECK(mood BETWEEN 1 AND 5),   -- 评分制，可做趋势分析
    weather     TEXT CHECK(weather IN (
                    '晴','多云','阴','雨','雪','雾','风'
                )),                                     -- 有穷枚举
    energy      INTEGER CHECK(energy BETWEEN 1 AND 5),  -- 评分制
    is_pinned   INTEGER DEFAULT 0                       -- 置顶标记
);
```

> `mood` 和 `energy` 用数字评分（1-5），便于聚合统计和趋势图表。
> `weather` 用检查约束限定枚举值，后续可扩展。

### 1.4 财务 `finance_transaction`

```sql
CREATE TABLE finance_transaction (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER NOT NULL UNIQUE REFERENCES record(id) ON DELETE CASCADE,

    amount      REAL NOT NULL,           -- 正=收入，负=支出
    currency    TEXT DEFAULT 'CNY',
    category    TEXT,                     -- 分类：餐饮/交通/购物/住房/娱乐/...
    account     TEXT,                     -- 账户：支付宝/微信/银行卡/现金

    CHECK(amount IS NOT NULL AND amount != 0)
);

CREATE INDEX idx_finance_category ON finance_transaction(category);
CREATE INDEX idx_finance_account ON finance_transaction(account);
```

> `category` 和 `account` 当前保留自由文本。后期可标准化为字典表。

### 1.5 时间 `time_log`

```sql
CREATE TABLE time_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id       INTEGER NOT NULL UNIQUE REFERENCES record(id) ON DELETE CASCADE,

    start_time      TEXT NOT NULL,        -- HH:MM
    end_time        TEXT NOT NULL,        -- HH:MM
    duration_minutes INTEGER GENERATED ALWAYS AS (
                        (CAST(strftime('%H', end_time) AS INTEGER) * 60 +
                         CAST(strftime('%M', end_time) AS INTEGER)) -
                        (CAST(strftime('%H', start_time) AS INTEGER) * 60 +
                         CAST(strftime('%M', start_time) AS INTEGER))
                    ) STORED,
    category        TEXT,                 -- 分类：学习/工作/运动/休闲/...

    plan_id         INTEGER REFERENCES plan_instance(id),  -- 追溯来源（→ plan_instance.task_id → task）
    category        TEXT,                 -- 无 plan 时使用

    CHECK(start_time < end_time)
);

CREATE INDEX idx_time_log_day ON time_log(date(start_time));
CREATE INDEX idx_time_log_plan ON time_log(plan_id);
```

**一致性规则：**

| 规则 | 实现 |
|------|------|
| `time_log.plan_id` | 从 done 操作自动填充 |
| task 查询路径 | time_log → plan_instance.task_id → task（一次 JOIN） |
| `time_log.plan_id` | 从 done 操作自动填充 |
| `record.occurred_at` | 从 `time_log.start_time` 的日期部分自动提取（应用层或 trigger） |

### 1.6 物品 `possession`

```sql
CREATE TABLE possession (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER NOT NULL UNIQUE REFERENCES record(id) ON DELETE CASCADE,

    item_name   TEXT NOT NULL,            -- 物品名称
    category    TEXT,                     -- 分类：电子/书籍/衣物/...
    location    TEXT,                     -- 位置：书房/卧室/办公室

    status      TEXT DEFAULT 'using' CHECK(status IN (
                    'using',    -- 使用中
                    'stored',   -- 收纳中
                    'lent',     -- 借出
                    'sold',     -- 已售/已出
                    'lost'      -- 遗失
                )),

    price       REAL,                     -- 购入价格
    acquired_at TEXT,                     -- 获取日期 (YYYY-MM-DD)
    source      TEXT                      -- 来源（店铺/赠予/自制）
);

CREATE INDEX idx_possession_status   ON possession(status);
CREATE INDEX idx_possession_category ON possession(category);
```

### 1.7 标签表 `record_tag`

`record.tags` 字段废弃，改用标准化多对多关联表：

```sql
CREATE TABLE record_tag (
    record_id   INTEGER NOT NULL REFERENCES record(id) ON DELETE CASCADE,
    tag         TEXT NOT NULL,
    PRIMARY KEY (record_id, tag)
);

CREATE INDEX idx_tag_lookup ON record_tag(tag);
```

**查询示例：**

```sql
-- 查找所有标签为"阅读"的记录
SELECT r.* FROM record r
WHERE EXISTS (
    SELECT 1 FROM record_tag rt
    WHERE rt.record_id = r.id AND rt.tag = '阅读'
);

-- 热门标签统计
SELECT tag, COUNT(*) as count
FROM record_tag
GROUP BY tag
ORDER BY count DESC;
```

---

## 2. 字段矩阵

| 字段 | diary | finance | time | possession | task |
|------|:-----:|:-------:|:----:|:----------:|:----:|
| `title` | 日记标题 | 用途描述 | 做了什么 | 物品名 → `item_name` | 任务标题 |
| `content` | 正文 | 备注 | 备注 | 物品描述 | 完成笔记 |
| `mood(1-5)` | ✅ | — | — | — | — |
| `weather(枚举)` | ✅ | — | — | — | — |
| `energy(1-5)` | ✅ | — | — | — | — |
| `amount` | — | ✅ 必填 | — | — | — |
| `category` | — | ✅ | ✅ | ✅ | — |
| `account` | — | ✅ | — | — | — |
| `start/end_time` | — | — | ✅ | — | — |
| `status` | — | — | — | ✅ | — |
| `price` | — | — | — | ✅ | — |
| `location` | — | — | — | ✅ | — |
| `plan_id` | — | — | ✅ | — | — |
| **特化表** | ✅ | ✅ | ✅ | ✅ | ❌ |

---

## 3. API

挂载在 `/api/records`，需登录。

### 3.1 `GET /api/records`

| 参数 | 默认 | 说明 |
|------|------|------|
| `kind` | — | `diary` / `finance` / `time` / `possession` / `task` |
| `project_id` | — | 按项目筛选 |
| `from` / `to` | — | 日期范围 |
| `tag` | — | 按标签筛选（走 record_tag） |
| `page` | 1 | |
| `page_size` | 20 | 最大 100 |

响应：

```json
{
    "items": [
        {
            "id": 1,
            "kind": "diary",
            "title": "平凡的一天",
            "content": "今天去了图书馆...",
            "tags": ["阅读", "平静"],
            "occurred_at": "2026-06-20",
            "detail": {
                "mood": 4,
                "weather": "晴",
                "energy": 3
            }
        },
        {
            "id": 2,
            "kind": "task",
            "title": "还书",
            "content": "在闭馆前还了",
            "tags": [],
            "occurred_at": "2026-06-20",
            "detail": null
        }
    ],
    "total": 42,
    "page": 1,
    "page_size": 20,
    "total_pages": 3
}
```

> `detail` 字段：有特化表则返回类型详情，`kind=task` 时为 `null`。
> `tags` 从 `record_tag` 表 JOIN 聚合为数组。

### 3.2 `POST /api/records`

```json
{
    "kind": "diary",
    "title": "平凡的一天",
    "content": "今天去了图书馆...",
    "occurred_at": "2026-06-20",
    "tags": ["阅读", "平静"],
    "detail": {
        "mood": 4,
        "weather": "晴",
        "energy": 3
    }
}
```

后端事务：
1. INSERT record
2. INSERT record_tag（多条）
3. INSERT 对应特化表（kind=task 时跳过）

### 3.3 `GET /api/records/{id}` / `PATCH /api/records/{id}` / `DELETE /api/records/{id}`

标准 CRUD，DELETE 级联清除特化表和标签。

### 3.4 `GET /api/records/stats`

```json
{
    "diary":    { "count": 14, "avg_mood": 3.8 },
    "finance":  { "income": 5000, "expense": 2340.5, "balance": 2659.5 },
    "time":     { "total_hours": 42.5, "top_category": "学习" },
    "possession": { "total": 23, "by_status": { "using": 18, "stored": 5 } },
    "task":     { "count": 7 }
}
```

---

## 4. 前端

### 4.1 新增文件

```
web/src/apis/recordApi.ts
web/src/apis/types/record.ts
web/src/pages/record/RecordsList.tsx
web/src/pages/record/RecordDetail.tsx
web/src/pages/record/RecordCreate.tsx
```

### 4.2 路由

```
/r          → RecordsList        (统一时间线)
/r/new      → RecordCreate        (按 kind 切换表单)
/r/:id      → RecordDetail
/r/diary    → RecordsList?kind=diary
/r/finance  → RecordsList?kind=finance
/r/time     → RecordsList?kind=time
/r/items    → RecordsList?kind=possession
```

### 4.3 统一时间线

```
┌──────────────────────────────────────────┐
│  [全部] [日记] [财务] [时间] [物品] [任务] │  ← kind Tab
├──────────────────────────────────────────┤
│  2026-06-20                               │  ← 按日期分组
│  ┌────────────────────────────────────┐   │
│  │ 📔 平凡的一天                 😊4  │   │
│  │ 今天去了图书馆，读完了一本书...      │   │
│  ├────────────────────────────────────┤   │
│  │ 💰 午餐                    -35.50  │   │
│  │ 食堂 — 餐饮                        │   │
│  ├────────────────────────────────────┤   │
│  │ ⏱️ 学习 Rust               2.5h   │   │
│  │ 14:00 → 16:30                     │   │
│  ├────────────────────────────────────┤   │
│  │ 📦 MacBook Pro             使用中  │   │
│  │ 书房 · ¥12,000                    │   │
│  ├────────────────────────────────────┤   │
│  │ ✅ 还书                            │   │
│  │ 在闭馆前还了                        │   │
│  └────────────────────────────────────┘   │
│  2026-06-19                               │
│  │ ...                                    │
└──────────────────────────────────────────┘
```

### 4.4 TypeScript 类型

```ts
// ── 记录种类 ──

type RecordKind = "diary" | "finance" | "time" | "possession" | "task";

// ── 基表 ──

interface Record {
    id: number;
    kind: RecordKind;
    title: string | null;
    content: string | null;
    tags: string[];                     // 从 record_tag 聚合
    occurred_at: string;
    project_id: number | null;
    created_at: string;
    updated_at: string;
}

// ── 特化详情 ──

interface DiaryDetail {
    mood: number | null;
    weather: string | null;
    energy: number | null;
    is_pinned: boolean;
}

interface FinanceDetail {
    amount: number;
    currency: string;
    category: string | null;
    account: string | null;
}

interface TimeDetail {
    start_time: string;
    end_time: string;
    duration_minutes: number;
    category: string | null;
    plan_id: number | null;
    // task 关联通过 plan_id → plan_instance.task_id 查询
}

interface PossessionDetail {
    item_name: string;
    category: string | null;
    location: string | null;
    status: "using" | "stored" | "lent" | "sold" | "lost";
    price: number | null;
    acquired_at: string | null;
    source: string | null;
}

type RecordDetail = DiaryDetail | FinanceDetail | TimeDetail | PossessionDetail | null;
// null 对应 kind='task'

interface RecordWithDetail extends Record {
    detail: RecordDetail;
}

interface PaginatedRecords {
    items: RecordWithDetail[];
    total: number;
    page: number;
    page_size: number;
    total_pages: number;
}
```

---

## 5. 与 task / plan 模块的关系

### 5.1 三层完整链路

```
task (工作单元)
│
├── feasible → time_window(type=feasible)
│
├── plan_series + plan_instance (安排)
│   │
│   └── POST done → time_log + record(kind=time)
│
└── POST complete { record: true }
    └── record(kind=task)       ← 快速完成，无 plan
```

### 5.2 项目维度

`record.project_id` → `task.id`。task 可以作为"项目容器"，聚合该项目下所有记录。

### 5.3 数据一致性

| 规则 | 层级 | 说明 |
|------|------|------|
| `time_log.task_id` | 应用层 | 从 `plan_instance.task_id` 继承，不可独立修改 |
| `time_log.plan_id` | 应用层 | 从 done 操作自动填充 |
| `record.occurred_at`(time_log) | 应用层 | 从 `start_time` 提取日期，不冗余存储 |
| `record_tag` | 级联 | `ON DELETE CASCADE` 确保标签随记录删除 |

---

## 6. 后续可标准化项目（当前不落地）

- `finance_transaction.category` / `account` → 独立字典表（便于预算统计和报表）
- `possession.category` / `location` → 同上
- `time_log.category` → 同上
- `diary_entry.mood` / `energy` → 可扩展评分锚点（如 mood=5 对应"极好"的描述）

---

## 7. 实施顺序

1. 建表：`record` + 4 张特化表 + `record_tag`
2. 后端 `modules/record/` CRUD 含事务写入（基表+特化表+标签）
3. 后端 stats 聚合接口
4. 路由注册
5. 前端 `recordApi.ts` + 类型定义
6. 前端 `RecordsList.tsx` 统一时间线
7. 前端各类型创建表单（按 kind 切换字段）
8. task 完成流转（`POST /api/tasks/{id}/complete?record=true`）
