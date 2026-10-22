# Anki FSRS 调度方式详解

> 状态：现行（已实现） · 代码基准：`main@48996cd7`（2026-10-22） · 最后核对：2026-10-22

> 基于 [Anki](https://github.com/ankitects/anki) 源码（`rslib/src/scheduler/`）分析，使用 `fsrs` crate **6.6.1**（FSRS-6）。本文的 Anki 源码结论来自外部快照；与 Brainbow 的对照以 `src/modules/mem` 为准。

---

## 1. 概述

Anki 的 FSRS（Free Spaced Repetition Scheduler）实现并非简单的"替换 Anki 默认算法"，而是对原调度体系进行深度重构：

- **核心不变**：卡牌状态机（New → Learning → Review ⇄ Relearning）未被改变
- **FSRS 接管 interval 计算**：原本由 ease factor + interval multiplier 计算的 review 间隔，改为由 FSRS 的 `next_states()` 直接给出
- **Learning/Relearning 步进保留**：FSRS 仍然保留 Anki 传统的学习步进机制（learn_steps / relearn_steps），不强制纯算法调度
- **新增概念**：memory_state（stability + difficulty）、desired_retention、历史 retention 校准

---

## 2. FSRS 启用判定

```rust
// rslib/src/scheduler/answering/mod.rs
fn fsrs_enabled(&self) -> bool {
    self.state
        .card_queues
        .as_ref()
        .and_then(|q| q.fsrs_enabled)
        .unwrap_or_else(|| self.get_config_bool(BoolKey::Fsrs))
}
```

启用来源：
1. **牌组配置（deck config）** 中的 `enable_fsrs` 开关
2. 在队列构建（queue build）时可选覆写
3. 全局配置兜底

---

## 3. FSRS 状态注入流程

### 3.1 回答卡牌时的完整链路

```
answer_card()
  └─ card_state_updater(card)           ← 构造 CardStateUpdater
       ├─ 读取牌组配置（deck config）
       ├─ 获取 desired_retention        ← 牌组预设（默认 0.9）
       ├─ 获取 fsrs_params()             ← FSRS-6 > FSRS-5 > FSRS-4 回退
       ├─ 创建 FSRS 实例                  ← fsrs::FSRS::new(params)
       ├─ 计算 days_elapsed              ← 距上次复习天数
       ├─ 调用 fsrs.next_states()        ← 核心：生成 next_states
       └─ 注入到 StateContext
  └─ current_state.next_states(ctx)     ← 状态机根据 ctx.fsrs_next_states 调度
```

### 3.2 `fsrs.next_states()` 调用点

```rust
// rslib/src/scheduler/answering/mod.rs
Some(fsrs.next_states(
    card.memory_state.map(Into::into),  // 当前 memory_state (stability, difficulty)
    desired_retention,                   // 预设 retention（默认 90%）
    days_elapsed,                        // 距上次复习的天数
)?)
```

**返回**：`NextStates { again, hard, good, easy }`，每个包含：
- `interval`（天）
- `memory`（新的 stability + difficulty）

---

## 4. 调度状态机详解

### 4.1 ReviewState — FSRS 的核心作用域

```rust
// rslib/src/scheduler/states/review.rs
impl ReviewState {
    pub(crate) fn next_states(self, ctx: &StateContext) -> SchedulingStates {
        if let Some(states) = &ctx.fsrs_next_states {
            // ── FSRS 模式 ──
            let (hard_interval, good_interval, easy_interval) =
                self.passing_review_intervals_fsrs(states);
            SchedulingStates {
                current: self.into(),
                again: self.answer_again_fsrs(states, ctx).into(),
                hard: self.answer_hard_fsrs(hard_interval, states, ctx).into(),
                good: self.answer_good_fsrs(good_interval, states, ctx).into(),
                easy: self.answer_easy_fsrs(easy_interval, states, ctx).into(),
            }
        } else {
            // ── 传统 SM-2 模式 ──
            // ...
        }
    }
}
```

当 FSRS 启用时，ReviewState 的 `next_states` 完全使用 FSRS 的 interval，不再使用 ease factor。

#### 4.1.1 Again（遗忘）

```rust
fn answer_again_fsrs(self, states: &NextStates, ctx: &StateContext) -> RelearnState {
    // 使用 FSRS 计算的 again.interval
    let (scheduled_days, memory_state) = (states.again.interval, Some(states.again.memory.into()));

    // 进入重学（Relearning）
    RelearnState {
        review: ReviewState {
            scheduled_days: scheduled_days.round().max(1.0) as u32,
            memory_state,
            lapses: self.lapses + 1,
            leeched: leech_threshold_met(self.lapses + 1, ctx.leech_threshold),
            ..self
        },
        learning: LearnState {
            remaining_steps: ctx.relearn_steps.remaining_steps(),
            scheduled_secs: 0,
            elapsed_secs: 0,
            memory_state,
        },
    }
}
```

**关键行为**：
- 遗忘后进入 Relearning 状态
- `states.again.interval` 是 FSRS 计算的"降 stability 后的新间隔"
- lapses +1，可能触发 leech 标记

#### 4.1.2 Hard / Good / Easy（通过）

```rust
fn passing_review_intervals_fsrs(&self, states: &NextStates) -> (u32, u32, u32) {
    // 直接从 FSRS 的 next_states 取 interval（天）
    let hard = states.hard.interval.max(1.0) as u32;
    let good = states.good.interval.max(1.0) as u32;
    let easy = states.easy.interval.max(1.0) as u32;
    (hard, good, easy)
}
```

每个评分对应 FSRS 算法计算的独特 interval：
- **Hard**：比 Good 更短的间隔（但比 Again 长）
- **Good**：基于当前 stability 和 desired_retention 的目标间隔
- **Easy**：比 Good 更长的间隔（最高 stability 增长）

### 4.2 LearnState — 步进 + FSRS 混合

```rust
// rslib/src/scheduler/states/learning.rs
fn answer_good(self, ctx: &StateContext) -> CardState {
    if self.remaining_steps > 1 {
        // ── 还有剩余步进：留在 learning ──
        LearnState {
            remaining_steps: self.remaining_steps - 1,
            scheduled_secs: ctx.steps.next_step_secs(self),
            memory_state: ctx.fsrs_next_states.as_ref().map(|s| s.good.memory.into()),
            ..self
        }
    } else {
        // ── 最后一步 → 毕业到 review ──
        let (scheduled_days, memory_state) = if let Some(states) = &ctx.fsrs_next_states {
            // FSRS 模式：使用 FSRS 的 interval
            (states.good.interval as u32, Some(states.good.memory.into()))
        } else {
            // 传统模式：使用 graduating_interval
            (ctx.graduating_interval_good, None)
        };
        ReviewState {
            scheduled_days,
            memory_state,
            ..ReviewState::default()
        }
    }
}
```

**关键行为**：
- 步进阶段（remaining_steps > 1）使用配置的学习步进间隔（如 [1min, 10min]）
- 步进完成时（最后一步）使用 FSRS 的 good.interval 毕业
- 即使 FSRS 启用，学习阶段的短间隔**仍然保留步进机制**
- memory_state 在步进中保持更新（虽短间隔用步进，但 memory_state 已按 FSRS 演进）

### 4.3 RelearnState — 重学步进 + FSRS 混合

```rust
// rslib/src/scheduler/states/relearning.rs
fn answer_good(self, ctx: &StateContext) -> CardState {
    if self.learning.remaining_steps > 1 {
        // 还有重学步进
        RelearnState {
            learning: LearnState {
                remaining_steps: self.learning.remaining_steps - 1,
                scheduled_secs: ctx.relearn_steps.next_step_secs(self.learning),
                memory_state: ctx.fsrs_next_states.as_ref().map(|s| s.good.memory.into()),
                ..self.learning
            },
            ..self
        }
    } else {
        // 最后一步 → 回到 review
        // 使用 FSRS 的 good.interval 作为 review interval
        let scheduled_days = ctx.fsrs_next_states
            .as_ref()
            .map(|s| s.good.interval as u32)
            .unwrap_or_else(|| /* 传统回退 */);
        CardState::Normal(NormalState::Review(ReviewState {
            scheduled_days,
            memory_state: ctx.fsrs_next_states.as_ref().map(|s| s.good.memory.into()),
            ..self.review
        }))
    }
}
```

**关键行为**：
- 重学步进保留（默认 [10min]）
- 最后一步用 FSRS 计算新的 review interval
- Again 在重学步进中使用 FSRS 的 again.interval（而非传统 lapse_multiplier）

### 4.4 NewState — 首次学习

```rust
// normal.rs 中：New 的 next_states 委托给 LearnState
NormalState::New(_) => {
    let next_states = LearnState {
        remaining_steps: ctx.steps.remaining_for_failed(),
        scheduled_secs: 0,
        elapsed_secs: 0,
        memory_state: None,
    }.next_states(ctx);  // 按 Learning 调度
}
```

新卡的首轮调度完全进入 LearnState 状态机，使用学习步进。

---

## 5. 调度策略全览

### 5.1 状态流转图

```
    New
     │
     ▼
┌──────────┐
│ LEARNING │◄──── 学习步进 [1m, 10m]
└────┬─────┘
     │ 最后一步通过（Good/Easy）
     ▼
┌──────────┐
│  REVIEW   │◄──── FSRS 按 memory_state 排期
└────┬─────┘
     │ 遗忘（Again）
     ▼
┌───────────┐
│ RELEARNING│◄──── 重学步进 [10m]
└─────┬─────┘
     │ 最后一步通过
     ▼
    REVIEW  （FSRS 算新 interval）
```

### 5.2 FSRS 干预点

| 状态 | 评分 | FSRS 的作用 |
|------|------|------------|
| Learning | Again/Hard | 步进间隔（不变），仅更新 memory_state |
| Learning | Good（最后一步）| 用 good.interval 毕业到 Review |
| Learning | Easy（最后一步）| 用 easy.interval 毕业到 Review |
| Review | Again | 用 again.interval 进入 Relearning |
| Review | Hard/Good/Easy | 用 FSRS 的 interval 直接作为新的 scheduled_days |
| Relearning | Again | 用 again.interval 重置重学 |
| Relearning | Good（最后一步）| 用 good.interval 回到 Review |
| Relearning | Easy（最后一步）| 用 easy.interval 回到 Review |

### 5.3 传统 vs FSRS 对比

| 方面 | 传统 SM-2 | FSRS |
|------|-----------|------|
| Review interval | `ease_factor * last_interval * interval_multiplier` | `fsrs.next_states().good.interval` |
| 遗忘后间隔 | `max(1, scheduled_days * lapse_multiplier)` | `fsrs.next_states().again.interval` |
| Hard 间隔 | `last_interval * hard_multiplier` | `fsrs.next_states().hard.interval` |
| Easy 间隔 | `last_interval * easy_multiplier` | `fsrs.next_states().easy.interval` |
| Memory state | 无 | `(stability, difficulty)` 双参数 |
| 个性化 | 手动调 ease | 按历史复习自动优化参数 |

---

## 6. FSRS 参数体系

### 6.1 牌组配置中的 FSRS 字段

```protobuf
// proto/anki/deck_config.proto

message DeckConfig {
    // FSRS 参数（三个版本回退链）
    // 参数个数按 fsrs crate 6.6.1 的 DEFAULT_PARAMETERS / FSRS 版本定义：
    // FSRS-4.5 = 17、FSRS-5 = 19、FSRS-6 = 21（第 21 个是 decay）
    repeated float fsrs_params_4 = 3;     // FSRS-4.x 参数（17个）
    repeated float fsrs_params_5 = 5;     // FSRS-5 参数（19个）
    repeated float fsrs_params_6 = 6;     // FSRS-6 参数（21个）

    // retention 目标
    float desired_retention = 37;         // 目标 retention（默认 0.9）
    float historical_retention = 40;      // 历史 retention（用于初始校准）
}
```

### 6.2 参数版本选择

```rust
pub fn fsrs_params(&self) -> &Vec<f32> {
    if !self.inner.fsrs_params_6.is_empty() {
        &self.inner.fsrs_params_6    // 优先 FSRS-6（21参数）
    } else if !self.inner.fsrs_params_5.is_empty() {
        &self.inner.fsrs_params_5    // 回退 FSRS-5（19参数）
    } else {
        &self.inner.fsrs_params_4    // 最后 FSRS-4.5（17参数）
    }
}
```

### 6.3 Decay 值选择

```rust
pub(crate) fn get_decay_from_params(params: &[f32]) -> f32 {
    if params.is_empty() {
        FSRS6_DEFAULT_DECAY   // fsrs 6.6.1：0.1542（FSRS-6 默认 decay）
    } else if params.len() < 21 {
        FSRS5_DEFAULT_DECAY   // fsrs 6.6.1：0.5（FSRS-5 默认 decay）
    } else {
        params[20]            // FSRS-6 的第 21 个参数是 decay
    }
}

// 注：遗忘曲线里用的是 `-decay`（`R = (1 + t/(S·factor))^(-decay)`），
// 所以上面两个默认值本身是正数，不要写成 ≈ -0.5。
```

---

## 7. Fuzz 与负载均衡

FSRS 模式下，Anki 在 FSRS 计算的 interval 之上额外叠加了**模糊化（Fuzz）**和**负载均衡（Load Balancing）**层。

### 7.1 模糊化（Fuzz）

为防止同一张卡在不同设备上的间隔微差导致"重复堆叠"，Anki 对所有 review interval 施加随机扰动：

```rust
// fuzz.rs — 区间模糊化
static FUZZ_RANGES: [FuzzRange; 3] = [
    FuzzRange { start: 2.5, end: 7.0,    factor: 0.15 },  // 短间隔 ±15%
    FuzzRange { start: 7.0, end: 20.0,   factor: 0.10 },  // 中间隔 ±10%
    FuzzRange { start: 20.0, end: MAX,    factor: 0.05 },  // 长间隔 ±5%
];
```

Fuzz 使用**确定性种子**（基于 card_id + review_count），同一张卡在不同设备上得到相同的 fuzz 结果。

### 7.2 负载均衡（Load Balancer）

额外层，用于分散同一笔记的多张卡（siblings）的到期日：

```rust
// load_balancer.rs
pub(crate) fn select_weighted_interval(
    intervals: impl Iterator<Item = LoadBalancerInterval>,
    fuzz_seed: u64,
) -> u32
```

**策略**：
1. 在 `[FSRS_interval - fuzz_range, FSRS_interval + fuzz_range]` 范围内生成多个候选 interval
2. 对每个候选 interval 计算权重：
   - **Sibling 惩罚**：与兄弟卡同天的 interval 权重极低
   - **Easy days 调节**：用户配置的"轻松日"（周几更愿意学习）有额外权重
3. 按权重随机选取（使用确定性种子）

### 7.3 FSRS 短间隔控制

```rust
fn fsrs_short_term_with_steps_enabled(&self) -> bool {
    self.state
        .card_queues
        .as_ref()
        .map(|q| q.fsrs_short_term_with_steps)
        .unwrap_or_else(|| self.get_config_bool(BoolKey::FsrsShortTermWithStepsEnabled))
}
```

控制 FSRS 在复习阶段是否允许产生短间隔（<1天）。当禁用时，FSRS 的 short-term 间隔会被步进机制接管。

---

## 8. 复习调度队列

FSRS 不影响队列构建逻辑，队列优先级仍然是：

```
1. Learning cards（按 due time）
2. Review cards + New cards（按用户配置的交错比例）
3. 按 ReviewCardOrder 排序（due time / interval / reverse）
```

区别在于 FSRS 模式下 review 队列的 `card.due` 由 FSRS interval 决定，而非 ease factor 计算。

---

## 9. 与 Brainbow 实现的对比

| 方面 | Anki FSRS | Brainbow |
|------|-----------|----------|
| FSRS crate | 6.6.1 | 6.6.1（FSRS-6，crate 默认 21 个参数；空 = 库默认值） |
| 步进机制 | learn_steps + relearn_steps（用户可配）| `MemConfig`（`app_settings` 的 `mem_config`）持久化，默认 `[60, 600]` / `[600]`；main 无修改配置的公开 API |
| 已掌握卡调度 | review 状态直接使用 FSRS interval | 同左；`due_at` 写入 `+00:00` 规范时间 |
| Fuzz | 多级 + 负载均衡 + sibling 分散 | 无 Fuzz；同轮候选由 `selection.rs` 按难度/遗忘/过期加权采样 |
| 参数优化 | 内置优化器（`compute_fsrs_params` / optimal retention）| `optimizer::optimize_fsrs_params`（`fsrs::compute_parameters`）；`POST /mem/optimize`，且每 20 次复习自动跑一次（revlog ≥10 条） |
| 历史 retention | `historical_retention` 配置（初始校准用）| 无 |
| desired_retention | 每个牌组可配（默认 0.9）| `MemConfig.desired_retention` 默认 0.9（持久化；无 UI/API 修改入口） |
| 短间隔控制 | `fsrs_short_term_with_steps` 可选 | 无此概念；固定步进 + Relearning 最低步进保护（`relearn_min_step_remaining`） |
| Leech 处理 | 自动打 `leech` 标签，可选暂停 | 仅标记 `leeched`（`lapses >= 5` 置位且不再回退），不自动暂停 |
| 前置依赖 | 无（但支持 sibling 分散）| `mem_prerequisite` 表；前置卡仍为 `new` 时后置卡不进池 |
| 复习写入 | 单卡状态更新 | `review_mem_atomic` 单事务（更新 mem + 插 revlog），`stability`/`last_review_at` 乐观锁，冲突 409 |
| 撤销 | Anki 有撤销栈 | 客户端回传复习前状态，服务端直接覆盖（无 event sourcing） |

> Brainbow 侧的时间字段（`mem.due_at` / `mem.last_review_at` / `revlog.review_time`）统一为 `%Y-%m-%dT%H:%M:%S+00:00`（不用 `Z`）；Anki 的 `cards.due` 是整数天/秒计数，两者存储形态不同，比较时别直接按字符串比。

---

## 10. 核心文件索引

```text
rslib/src/scheduler/
├── answering/
│   └── mod.rs                    ← FSRS 注入点：card_state_updater()
├── states/
│   ├── mod.rs                    ← StateContext 定义（含 fsrs_next_states）
│   ├── review.rs                 ← ReviewState::next_states（FSRS 核心）
│   ├── learning.rs               ← LearnState 步进 + FSRS 混合
│   ├── relearning.rs             ← RelearnState 步进 + FSRS 混合
│   ├── normal.rs                 ← New→Learning 桥接
│   ├── fuzz.rs                   ← 间隔模糊化
│   └── load_balancer.rs          ← 负载均衡（sibling 分散 + easy days）
├── fsrs/
│   ├── mod.rs                    ← 模块声明
│   ├── params.rs                 ← FSRS 参数计算（compute_fsrs_params）
│   ├── memory_state.rs           ← memory_state 回顾计算（FSRSItem 构造）
│   ├── rescheduler.rs            ← 批量重排（用于参数变更后）
│   ├── retention.rs              ← optimal_retention 计算
│   ├── simulator.rs              ← 模拟器 + 负载均衡集成
│   └── error.rs                  ← FSRS 错误转换
└── queue/
    └── builder/                  ← 队列构建（不受 FSRS 影响）
```
