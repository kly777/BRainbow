# 记忆模块 v2 — 设计方案

> 状态：提案（未合入 main） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 基于幂律遗忘曲线的自适应复习调度。**当前 main 仍是 FSRS**（`src/modules/mem/fsrs/`，`fsrs` 6.6.1）：本文的 `a0/d/b` 字段、`scheduler.rs`、`mastery` 请求体在 main 都不存在，下面的 DDL/响应/文件路径都是提案，不要当现状引用。

---

## 1. 设计理念

### 1.1 极简

每张卡只存三个核心参数：**初始回忆概率 a₀**、**固有难度 D**、**当前衰减指数 b**。
没有需要训练/校准的全局参数（`k`、`R₀` 是硬编码常数），不需要离线优化器。

### 1.2 透明

用户可以理解系统为什么做出某个排期决策："上次你输入 0.85，模型预期你 3 天后还有 75% 的回忆概率，所以安排了 3 天。"

### 1.3 连续输入

用户输入一个 `m ∈ [0, 1]` 的浮点数，表示自己感觉的掌握程度，而不是离散的四个按钮。信息量从 2 bits 提升到接近连续，自适应更灵敏。

| m 范围 | 感觉 | 效果 |
|--------|------|------|
| 0.0~0.3 | 完全不记得 | 进入重学 |
| 0.3~0.6 | 有点印象但不稳 | 不涨间隔 |
| 0.6~0.85 | 基本记住 | 间隔 ×2 |
| 0.85~1.0 | 很轻松 | 间隔 ×2.5 |

---

## 2. 记忆模型

### 2.1 幂律遗忘曲线

```
R(t) = a₀ · (1 + k·t)^(-b)
```

| 符号 | 含义 | 范围 | 存储 |
|------|------|------|------|
| `R(t)` | 复习后 t 天时的回忆概率 | [0, 1] | 不存，实时计算 |
| `a₀` | 复习刚结束时的初始回忆概率 | [0.5, 1.0] | 每张卡 |
| `k` | 全局时间缩放常数 | 固定值 0.5 | 代码硬编码 |
| `b` | **当前衰减指数** | [D×0.3, D×2.0] | 每张卡 |
| `D` | **固有难度** | [0.3, 5.0] | 每张卡 |
| `t` | 距离上次复习的天数 | [0, ∞) | 由 `due_at` 计算 |

### 2.2 为什么要幂律而不是指数？

```
指数衰减: R(t) = a₀ · e^(-t/S)
幂律衰减: R(t) = a₀ · (1 + k·t)^(-b)
```

大量记忆研究表明，人类遗忘遵循幂律而非指数规律——**开头忘得快，越到后面忘得越慢**。指数衰减会低估长期 retention。

> **与 main 的 FSRS 对照（重要）**：FSRS 本身也不是指数衰减 —— `fsrs` 6.6.1 用的是幂律遗忘曲线 `R = (1 + t/(S·factor))^(-decay)`（`decay` 默认 0.1542，见 `fsrs::current_retrievability`）。所以 v2 与 FSRS 的差异不是"幂律 vs 指数"，而是参数化方式：v2 用 `a₀ / D / b` 三个可解释参数、把固有难度 D 与当前衰减 b 分离、接受连续 mastery 输入并在线微调。

### 2.3 D（固有难度）和 b（当前衰减指数）的关系

这是本设计的核心区分。

| 参数 | 含义 | 变化频率 | 变化方向 |
|------|------|---------|---------|
| **D** | 这张卡的**固有难度** | 几乎不变 | 由首次复习时的 m 决定初始值 |
| **b** | 当前记忆的**衰减速度** | 每次复习变化 | 成功则 b↓（更巩固），失败则 b↑（退化） |

**b 的初始值 = D**。之后每次复习：

```
复习成功 (m ≥ 0.7) → b -= 0.3 × (m - 0.7)    // 衰减变慢
复习失败 (m < 0.4) → b += 0.3 × (0.4 - m)    // 衰减加快

b 始终 ≥ D × 0.3   （再巩固也不会低于固有难度的 30%）
b 始终 ≤ D × 2.0   （再退化也不会超过固有难度的 2 倍）
```

**示例**：

```
一张中等难度的卡:
  D = 2.0（固有难度，由内容决定）
  b = 2.0（初始等于 D）

第1次 m=0.80 → b = 2.0 - 0.3×(0.8-0.7) = 1.97 (巩固了一点)
第2次 m=0.85 → b = 1.97 - 0.3×(0.85-0.7) = 1.93
第3次 m=0.75 → b = 1.93 - 0.3×(0.75-0.7) = 1.92
第4次 m=0.20 → b = 1.92 + 0.3×(0.4-0.2) = 1.98 (退化了)
第5次 m=0.90 → b = 1.98 - 0.3×(0.9-0.7) = 1.92
```

**为什么这样设计**：

- **D 固定**——卡片内容不会变，"什么是 FSRS"这道题的固有难度始终是那道题本身的属性
- **b 浮动**——但你的记忆是会巩固的。同一张卡复习 10 次后，你记住它的速度会比第一次快得多，b 的下降反映了这种巩固
- 最坏情况（长期不复习）b 最多退化到 D×2.0，不会无限恶化
- 最好情况（每次 Easy）b 最低降到 D×0.3，衰减极慢

---

## 3. 状态机

```
        创建
          │
          ▼
      ┌──────┐
   ┌──│  NEW  │
   │  └──────┘
   │  首次复习（m ≥ 0）
   │     │
   │     ▼
   │ ┌──────────┐     m ≥ 0.7
   │ │ LEARNING │──────────────┐
   │ └─────┬────┘              │
   │  m<0.4 │ 0.4≤m<0.7        │
   │  ──┬──│                    │
   │    │  │                    │
   │    ▼  ▼                   │
   │ 回退step 不动              │
   │                           ▼
   │                      ┌──────────┐
   │                      │  REVIEW  │
   │                      └────┬─────┘
   │                     ┌─────┼─────┐
   │                     │     │     │
   │                   m<0.4 0.4~0.7 ≥0.7
   │                     │     │     │
   │                     ▼     │   ──┴──
   │              ┌────────────┐  间隔×2或×2.5
   │              │ RELEARNING │  更新 a₀、b
   │              └─────┬──────┘
   │               m≥0.7    m<0.7
   │                 │        │
   │                 ▼        ▼
   │           回到 REVIEW  留在 RELEARNING
   │          步进结束      步进不变或回退
   │
   └─── 重置 API ──→ NEW
```

### 3.1 状态表

| 状态 | 含义 | 行为 |
|------|------|------|
| `NEW` | 未学习 | 首次复习后进入 LEARNING |
| `LEARNING` | 步进阶段 | 固定间隔 [1min, 10min]，毕业后进入 REVIEW |
| `REVIEW` | 正常复习 | 用模型公式计算间隔，每次更新 a₀、b |
| `RELEARNING` | 遗忘后巩固 | 固定间隔 [10min]，毕业后回 REVIEW |
| `BURIED` | 被用户隐藏 | 不参与排期（注：main 的 `buried` 是独立列，不是 `state` 值；若沿用现有 schema，不必把它新增成状态） |

### 3.2 步进阶段规则

#### LEARNING

步进表：`[60s, 600s]`

```
m ≥ 0.7  → step+1（最后一步则毕业到 REVIEW）
0.4 ≤ m < 0.7 → step 不变，同样间隔再来一次
m < 0.4  → step = 0（回退到第一步）
```

#### RELEARNING

步进表：`[600s]`（只有一步，通过即毕业）

```
m ≥ 0.7 → 毕业到 REVIEW
m < 0.7 → 留在 RELEARNING，m<0.4 则回退 step=0
```

进入 RELEARNING 时 **b 按照失败规则上调**（记忆退化）。毕业回到 REVIEW 时使用上调后的 b。

---

## 4. Review 调度

### 4.1 到期预测

卡片到期时，模型根据当前参数和经过天数做预测：

```rust
let k = 0.5;  // 全局常数
let r_pred = a₀ * (1.0 + k * days_elapsed).powf(-b);
```

`r_pred` 是模型预期你此刻还能记住的概率。

### 4.2 间隔计算

设定目标 retention `R₀ = 0.85`：

```rust
if a₀ <= R₀ {
    t_next = 1.0  // 1 天兜底
} else {
    t_next = ((a₀ / R₀).powf(1.0 / b) - 1.0) / k;
    t_next = t_next.clamp(1.0, 365.0);
}
```

### 4.3 参数更新

用户输入 `m ∈ [0, 1]`。

#### 更新 a₀

把 a₀ 向用户的实际掌握度拉近：

```rust
a₀_new = a₀ + 0.3 * (m - a₀);
a₀_new = a₀_new.clamp(0.5, 1.0);
```

#### 更新 b（当前衰减指数）

```
m ≥ 0.7 → b_new = b - 0.3 × (m - 0.7)     // 巩固了，衰减变慢
m < 0.4 → b_new = b + 0.3 × (0.4 - m)     // 退化了，衰减加快
否则    → b_new = b                         // 原地踏步

b_new = b_new.clamp(D * 0.3, D * 2.0)
```

#### D（固有难度）不变

D 由卡片内容决定。当前设计下 D 初始为 1.5，**不随复习变化**。
未来如果需要支持初始化 D（如首次 review 的 m 很低 → D 增大），可以扩展，但目前保持简单。

### 4.4 间隔增长 vs 原地不动

```
m ≥ 0.85 → 间隔 ×2.5
0.7 ≤ m < 0.85 → 间隔 ×2.0
0.4 ≤ m < 0.7 → 间隔不变（上次间隔再来一次）
m < 0.4  → 进入 RELEARNING
```

间隔增长和参数更新**同时进行**。b 的更新是长期自适应，间隔倍率是本次排期的直接依据。

---

## 5. 数据模型

### 5.1 mem 表

```sql
CREATE TABLE mem (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cue_chunk_id    INTEGER NOT NULL REFERENCES chunk(id),
    target_chunk_id INTEGER NOT NULL REFERENCES chunk(id),

    -- 记忆参数
    a0              REAL DEFAULT 0.9,   -- 初始回忆概率 [0.5, 1.0]
    d               REAL DEFAULT 1.5,   -- 固有难度 [0.3, 5.0]（几乎不变）
    b               REAL DEFAULT 1.5,   -- 当前衰减指数 [D×0.3, D×2.0]（每次复习变化）

    -- 状态
    state           TEXT DEFAULT 'new',  -- new | learning | review | relearning
    step_index      INTEGER,            -- 步进位置

    -- 排期（时间格式沿用项目统一约定）
    due_at          TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
    last_review_at  TIMESTAMP,

    -- 辅助
    buried          INTEGER DEFAULT 0,
    lapses          INTEGER DEFAULT 0,
    leeched         INTEGER DEFAULT 0,

    -- 元数据
    created_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),

    FOREIGN KEY (cue_chunk_id)    REFERENCES chunk(id),
    FOREIGN KEY (target_chunk_id) REFERENCES chunk(id)
);
```

相比当前 main 的 `mem`（`stability` / `difficulty` + FSRS 调度），提案移除这两个 FSRS 参数，改为 `a0`、`d`、`b`。

> 注：main 的 `mem` 还有 `user_id`（归属）与 `in_pool`（历史列）；本提案稿没列出它们。真合入时必须保留 `user_id` 并按 `Actor` 判据过滤（见 `doc/design/authorization.md`），时间列继续进 `crates/db/src/schema/time.rs` 的 `TIME_COLUMNS`。

### 5.2 响应格式

以下是**提案**的响应形状；main 的实际响应是 `stability` / `difficulty` / `lapses` / `leeched` / `mnemonic`（见 `memory-system.md` §5.2），请求体是 `rating: 1..=4` 而不是 `mastery`。

```json
// GET /mem/due（提案）
{
  "items": [
    {
      "id": 42,
      "cue": { "id": 1, "content": "..." },
      "target": { "id": 2, "content": "..." },
      "a0": 0.87,
      "d": 1.5,
      "b": 1.3,
      "state": "review",
      "r_pred": 0.72,
      "due_at": "2026-07-05T12:00:00+00:00"
    }
  ]
}

// POST /mem/{id}/review（提案）
// Request:  { "mastery": 0.85 }
// Response: { "a0": 0.88, "d": 1.5, "b": 1.28, "r_pred": 0.85, "due_at": "2026-07-08T12:00:00+00:00" }
```

### 5.3 API 变更

| 当前 | v2 |
|------|-----|
| `rating: 1..=4` | `mastery: f64` (0~1) |
| `ReviewRequest { rating }` | `ReviewRequest { mastery }` |
| `UndoRequest { state, stability, difficulty, ... }` | `UndoRequest { a0, d, b, state, ... }` |

---

## 6. 架构分层（提案）

```
src/modules/mem/
├── mod.rs         路由注册（沿用 main 的 read/write 拆分）
├── model.rs       数据模型（mastery 替代 rating，增加 a0/d/b）
├── handler.rs     HTTP handlers（更新字段名）
├── service.rs     业务逻辑（a₀/b 更新、间隔计算）
└── scheduler.rs   新增：核心调度算法（幂律曲线计算）
```

> main 上没有 `scheduler.rs`：现状是 `fsrs/`（FSRS 调度纯函数）+ `repository/` + `config.rs` / `optimizer.rs` / `selection.rs`，见 `memory-system.md` §6。下面的函数表是提案。

`scheduler.rs` 是纯函数模块，包含：

| 函数 | 用途 |
|------|------|
| `r_pred(a0, b, days_elapsed)` | 计算预测回忆率 |
| `next_interval(a0, b)` | 计算下次间隔（天） |
| `update_a0(a0, mastery)` | 更新初始回忆概率 |
| `update_b(b, d, mastery)` | 更新当前衰减指数 |
| `schedule(...)` | 总入口：决定新状态 + 新间隔 |

---

## 7. 初始值设计

| 参数 | 默认值 | 理由 |
|------|--------|------|
| `a₀` | 0.9 | 假设初次学习后能记住 90% |
| `D` | 1.5 | 中等固有难度 |
| `b` | = D | 初始等于固有难度 |
| `k` | 0.5 | 全局常数 |
| `R₀` | 0.85 | 目标回忆率 |

这几组值让新卡的前几次行为：

```
创建: a₀=0.9, D=1.5, b=1.5

Learning step 0 (1min) → m=0.85 → step 1
Learning step 1 (10min) → m=0.75 → 毕业到 REVIEW
  首次 REVIEW: a₀=0.9→0.88, b=1.5→1.49
  t=((0.88/0.85)^(1/1.49)-1)/0.5 ≈ 0.5 → 兜底 1 天
  间隔×2 = 2天

第2次 REVIEW: t=2, R_pred=0.88×2.0^(-1.49)=0.88×0.36=0.31
  m=0.80 → a₀=0.88→0.86, b=1.49→1.46
  间隔×2 = 4天

第3次 REVIEW: t=4, R_pred=0.86×3.0^(-1.46)=0.86×0.21=0.18
  m=0.85 → a₀=0.86→0.86, b=1.46→1.42
  间隔×2.5 = 10天

第4次 REVIEW: t=10, R_pred=0.86×6.0^(-1.42)=0.86×0.09=0.08
  m=0.90 → a₀=0.86→0.87, b=1.42→1.36
  间隔×2.5 = 25天
```

间隔增长：1 天 → 2 天 → 4 天 → 10 天 → 25 天 → ... ✓

---

## 8. 迁移方案

> 以下均未实现；main 没有这条迁移。真落地时按项目规则改 `crates/db/src/schema/tables.rs` + `SCHEMA_VERSION += 1`，旧列登记进 `legacy.rs`、需要搬值/回填的写幂等 `repairs.rs`，并把新时间列补进 `TIME_COLUMNS`（见 `doc/guides/database.md`）。

### 8.1 现有数据兼容

- `stability` → 丢弃（提案）
- `difficulty` → 丢弃（提案）
- 新字段 `a0` 初始 0.9，`d` 初始 1.5，`b` 初始 1.5
- `new` 状态卡片自动采用新模型
- `review` 状态卡片到期后首次 review 即转为新模型

### 8.2 代码替换

| 文件 | 操作 |
|------|------|
| `src/modules/mem/fsrs/` | 删除/替换为 `scheduler.rs` |
| `src/modules/mem/service.rs` / `query.rs` | 修改 `apply_review`（service）与 `preview`（query）调用 |
| `src/modules/mem/model.rs` | 替换 `rating` 为 `mastery`，更新 struct |
| `src/modules/mem/handler.rs` | 对应字段更新 |
| `web/src/domains/mem/api*.ts` + `api-types.ts` | 前端对应更新（main 已是这个路径，不再是 `web/src/apis/memApi.ts`） |

---

## 9. 和 FSRS 的对比

> 下表是 v2 的设计取舍，不是 main 现状；main 的 FSRS 行为见 `memory-system.md`。

| 维度 | FSRS（main） | v2（幂律，提案） |
|------|------|-----------|
| 每张卡存 | 2 参数 (S, D) | 3 参数 (a₀, D, b) |
| 全局参数 | 21 个（FSRS-6，crate 默认；需优化） | 2 个 (k, R₀) |
| 遗忘模型 | 幂律（R = (1 + t/(S·factor))^(-decay)） | 幂律（a₀·(1+k·t)^(-b)） |
| 固有难度 vs 衰减 | 未区分（S 与 D） | D 固定，b 浮动 |
| 用户输入 | 4 级 rating | 连续 0-1 浮点 |
| 参数校准 | 离线优化器（`optimize_fsrs_params` / `compute_parameters`） | 在线自适应（每次复习微调） |
| 透明性 | 低（黑箱参数） | 中（可解释公式） |
| 实现复杂度 | 高（依赖 fsrs crate） | 低（纯数学，无外部依赖） |
