//! 时段建议（slotting）：把排序后的任务装进工作时段里的空档。
//!
//! **纯读，不落库**（P9）：`GET /api/tasks/suggestions` 只算给人看，采纳是前端
//! 显式调 `POST /api/time-windows`。系统绝不自己写日历。
//!
//! ## 为什么贪心装箱够用
//!
//! 装箱是 NP-hard，但关键不是最优而是**在线/离线之别**：在线只能对"当下看到的"
//! 做决策，而这里每次都是重算（用户改一次日历就重来一遍），离线解的价值因此很低。
//! 更重要的是 Timefold 那句 "**80% feasible is 100% useless**" —— 一份不可执行的
//! 建议表比没有更糟，因为用户会放弃整个功能。
//!
//! 贪心还因为**用户会点掉不对的建议**：采纳是一次点击、不采纳零成本（算法 aversion
//! 的实证结论，见 05 §1）。所以这里不追求最优解，追求"每一条都能真的排进去"。
//!
//! ## 诚实比完备重要
//!
//! 排不下的任务进 `unscheduled` 并**说清为什么**，而不是塞进一个塞满的日历：
//! 依赖未解除 / 容量已满 / 截止在区间之外，三种文案各自不同。

use chrono::{DateTime, Datelike, Duration, Timelike, Utc};
use serde::{Deserialize, Serialize};

use super::ranking::Ranked;

/// 建议对齐粒度：人安排一件事的时间就在这四档上（05 §3.3 第 3.d 步）
pub const SLOT_GRANULARITY_MINUTES: i64 = 15;

/// 循环窗口展开的段数上限。`time_window::expand_between` 自己的上限是 500（单窗），
/// 这里用更小的：建议只看接下来几天，几百段说明数据有问题，该 warn 而不是全展开。
pub const MAX_EXPANDED_SEGMENTS: usize = 52;

/// 一天里的一个工作区间，**本地钟点**（0 = 午夜）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeRange {
    pub start_minute: i32,
    pub end_minute: i32,
}

impl TimeRange {
    /// 半开区间；`end <= start` 视为无效（调用方过滤）
    fn is_valid(&self) -> bool {
        self.start_minute < self.end_minute
    }
}

/// 工作时段偏好（**本地钟点** —— "我 9 点开始工作"说的是钟点不是 UTC 时刻）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkingHours {
    /// 一天里的工作区间
    pub ranges: Vec<TimeRange>,
    /// 一周里的工作日：1 = 周一 … 7 = 周日（与 `time_window.by_weekdays` 同约定）
    pub weekdays: Vec<u8>,
    /// 单个建议的时长上限（分钟）
    pub max_slot_minutes: i32,
}

impl Default for WorkingHours {
    /// 默认 09:00–12:00 + 14:00–18:00，周一至周五，单段上限 120 分钟
    fn default() -> Self {
        Self {
            ranges: vec![
                TimeRange {
                    start_minute: 9 * 60,
                    end_minute: 12 * 60,
                },
                TimeRange {
                    start_minute: 14 * 60,
                    end_minute: 18 * 60,
                },
            ],
            weekdays: vec![1, 2, 3, 4, 5],
            max_slot_minutes: 120,
        }
    }
}

/// 一条建议的置信度（05 §3.3 的表）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    /// 有明确 due 或显式优先级，且时长是用户给的
    High,
    /// 时长被上限截断，或 due 在 7 天以上
    Medium,
    /// 时长是**估的** —— 界面用弱化样式（虚线边框 + 「约」前缀），不隐藏
    Low,
}

/// 一条建议（**不落库**）
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Suggestion {
    pub task_id: i32,
    pub title: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub effort_minutes: i64,
    /// 最高贡献的那条理由（完整分解在 `ranked.reasons` 里）
    pub reason: String,
    pub score: f64,
    pub confidence: Confidence,
}

/// 排不下的任务 + **为什么**
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Unscheduled {
    pub task_id: i32,
    pub title: String,
    pub reason: String,
}

/// 区间内的容量账（透明：用户看得见"还剩多少"）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Capacity {
    pub total_minutes: i64,
    pub used_minutes: i64,
    pub suggested_minutes: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SlottingResult {
    pub suggestions: Vec<Suggestion>,
    pub unscheduled: Vec<Unscheduled>,
    pub capacity: Capacity,
}

/// 建议算法的输入（三样，缺一不可 —— P10）
#[derive(Debug, Default, Clone)]
pub struct SlotContext {
    /// ① 硬占用：`planned` + `actual`（**`feasible` 不算**，它是软信息，见 §3.5）
    pub busy: Vec<(DateTime<Utc>, DateTime<Utc>)>,
    /// ② 工作时段偏好
    pub working_hours: WorkingHours,
    /// ③ 候选任务（已按 score 排好序）
    pub candidates: Vec<Candidate>,
}

/// 一条候选（任务 + 它的排序结果）
#[derive(Debug, Clone)]
pub struct Candidate {
    pub task_id: i32,
    pub title: String,
    pub ranked: Ranked,
    pub effort_minutes: Option<i32>,
    pub due_at: Option<DateTime<Utc>>,
    /// 有未完成的前置依赖时是它的标题
    pub blocked_by: Option<String>,
}

/// 算建议。**不写库、不改任何状态**。
pub fn suggest(
    ctx: &SlotContext,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    now: DateTime<Utc>,
) -> SlottingResult {
    // 空闲集 = 工作时段 − 硬占用
    let mut free = free_set(ctx, from, to);
    // `total_minutes` 是**工作时段总容量**（扣 busy 之前）：它要和 `used_minutes`
    // 相加才是用户脑子里的"这段时间一共多少"。拿扣完 busy 的当总量会低估，
    // 界面上"还剩多少"就永远算不对。
    let total_minutes: i64 = working_slots(&ctx.working_hours, from, to)
        .iter()
        .map(|(s, e)| minute_len(*s, *e))
        .sum();
    let used_minutes = busy_minutes(ctx, from, to);

    let mut suggestions = Vec::new();
    let mut unscheduled = Vec::new();

    // 候选已按 score 降序（`Ranked` 由 `sort_ranked` 排好），贪心按这个顺序装
    for candidate in &ctx.candidates {
        // b. 依赖未解除 —— 先判这条，因为"等谁"是最需要被看见的理由
        if let Some(blocker) = &candidate.blocked_by {
            unscheduled.push(Unscheduled {
                task_id: candidate.task_id,
                title: candidate.title.clone(),
                reason: format!("等「{blocker}」完成"),
            });
            continue;
        }

        // a. 时长：缺失 → 估一个（并降到 low）；超上限 → 截断（降到 medium）
        let (minutes, estimated, truncated) = duration_for(candidate, &ctx.working_hours);

        // c. 截止在区间之外 —— 排了也来不及
        if let Some(due) = candidate.due_at
            && due < from
        {
            unscheduled.push(Unscheduled {
                task_id: candidate.task_id,
                title: candidate.title.clone(),
                reason: "截止日期在这段时间之外".into(),
            });
            continue;
        }

        // d. 找空闲集里最早的、够长的连续段（15 分钟对齐）
        let Some((start, end)) = first_fit(&mut free, minutes) else {
            // e. 找不到 —— 这就是 S6-f 要的诚实：返回空 + "排不下"，而不是塞满日历
            unscheduled.push(Unscheduled {
                task_id: candidate.task_id,
                title: candidate.title.clone(),
                reason: "这段时间排不下了".into(),
            });
            continue;
        };

        // f. 采纳到建议里，并从空闲集扣掉
        let confidence = confidence_of(candidate, estimated, truncated, now);
        suggestions.push(Suggestion {
            task_id: candidate.task_id,
            title: candidate.title.clone(),
            start,
            end,
            effort_minutes: minutes,
            reason: candidate.ranked.summary(),
            score: candidate.ranked.score,
            confidence,
        });
    }

    let suggested_minutes: i64 = suggestions
        .iter()
        .map(|s| (s.end - s.start).num_minutes())
        .sum();

    SlottingResult {
        suggestions,
        unscheduled,
        capacity: Capacity {
            total_minutes,
            used_minutes,
            suggested_minutes,
        },
    }
}

fn busy_minutes(ctx: &SlotContext, from: DateTime<Utc>, to: DateTime<Utc>) -> i64 {
    ctx.busy
        .iter()
        .map(|(s, e)| minute_len((*s).max(from), (*e).min(to)))
        .sum()
}

fn minute_len(start: DateTime<Utc>, end: DateTime<Utc>) -> i64 {
    let len = end.signed_duration_since(start).num_minutes();
    if len > 0 { len } else { 0 }
}

/// 时长：缺失 → 估（标题长度 × 3 分钟，上限 60）；超上限 → 截断
fn duration_for(candidate: &Candidate, hours: &WorkingHours) -> (i64, bool, bool) {
    let cap = i64::from(hours.max_slot_minutes).max(SLOT_GRANULARITY_MINUTES);
    match candidate.effort_minutes {
        Some(minutes) if minutes > 0 => {
            let minutes = i64::from(minutes);
            if minutes > cap {
                (snap_down(cap), false, true)
            } else {
                (snap_down(minutes), false, false)
            }
        }
        // 没填时长 → 估一个，并且明确标成 low（界面上给「约」前缀与点线边框）
        _ => (snap_down(60.min(cap)), true, false),
    }
}

/// 向下取到 15 分钟网格：宁可少排一点，也不要超出用户给的上限
fn snap_down(minutes: i64) -> i64 {
    (minutes / SLOT_GRANULARITY_MINUTES) * SLOT_GRANULARITY_MINUTES
}

/// 置信度（05 §3.3 的表）
fn confidence_of(
    candidate: &Candidate,
    estimated: bool,
    truncated: bool,
    now: DateTime<Utc>,
) -> Confidence {
    if estimated {
        return Confidence::Low;
    }
    if truncated {
        return Confidence::Medium;
    }
    // due 在 7 天以上也算 medium（太远，等于没有承诺）
    let far_due = candidate
        .due_at
        .map(|due| due > now + Duration::days(7))
        .unwrap_or(false);
    if far_due {
        return Confidence::Medium;
    }
    // 有明确 due 或显式优先级 = high；什么都没有 = low
    let committed = candidate.due_at.is_some()
        || candidate.ranked.reasons.iter().any(|reason| {
            matches!(
                reason.kind,
                super::ranking::ReasonKind::Priority | super::ranking::ReasonKind::DueToday
            )
        });
    if committed {
        Confidence::High
    } else {
        Confidence::Low
    }
}

/// 空闲集：工作时段 ∩ [from, to] − busy
fn free_set(ctx: &SlotContext, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<Interval> {
    let mut slots: Vec<Interval> = working_slots(&ctx.working_hours, from, to);
    for (busy_start, busy_end) in &ctx.busy {
        slots = subtract(slots, *busy_start, *busy_end);
    }
    slots
}

type Interval = (DateTime<Utc>, DateTime<Utc>);

/// 把工作时段按本地日历展开到 `[from, to]`
///
/// **本地日**而不是 UTC 日：工作时段说的是"我 9 点开始工作"，那是他所在时区的 9 点。
/// 这是已知限制（R5：设置存本地钟点，跨时区用户会觉得偏移），单时区用户无感。
fn working_slots(hours: &WorkingHours, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<Interval> {
    let mut slots = Vec::new();
    let mut day = from.with_timezone(&chrono::Local).date_naive();
    let last = to.with_timezone(&chrono::Local).date_naive();

    // 上限：区间再大也不超过 MAX_EXPANDED_SEGMENTS 段工作时段 —— 边界上的坏数据
    // 不该让这段变成一个几十 MB 的循环
    while day <= last && slots.len() < MAX_EXPANDED_SEGMENTS {
        // 1 = 周一 … 7 = 周日（与 `time_window.by_weekdays` 同约定）
        let iso = day.weekday().number_from_monday() as u8
            + u8::from(day.weekday() == chrono::Weekday::Sun);
        if hours.weekdays.contains(&iso) {
            for range in &hours.ranges {
                if !range.is_valid() {
                    continue;
                }
                let start = local_minute_of(day, range.start_minute);
                let end = local_minute_of(day, range.end_minute);
                let start = start.max(from);
                let end = end.min(to);
                if start < end {
                    slots.push((start, end));
                }
            }
        }
        day += chrono::Duration::days(1);
    }
    slots
}

/// 某个本地日的第 N 分钟 → UTC
///
/// 夏令时切换那天这个钟点可能不存在或出现两次：不存在时用 `earliest()` 兜到该日的
/// 第一个合法时刻，重复时取**第一个**（保守：宁可早一点开始，别把时段推到用户已经
/// 下班之后）。单时区用户永远走不到这两条分支。
fn local_minute_of(day: chrono::NaiveDate, minute_of_day: i32) -> DateTime<Utc> {
    // `day` 来自日期迭代，`and_hms_opt` 对 0/0/0 与任何合法钟点都不会失败；
    // 真失败了（理论上不可达）就退回该日的 UTC 零点 —— 生产代码禁 panic，
    // 而"返回个错的时刻"在这里的后果只是建议落到偏一点的位置（界面上看得见）
    let midnight = || {
        day.and_hms_opt(0, 0, 0)
            .map(|n| n.and_utc())
            .unwrap_or_else(Utc::now)
    };
    let Some(naive) = day.and_hms_opt((minute_of_day / 60) as u32, (minute_of_day % 60) as u32, 0)
    else {
        return midnight();
    };
    naive
        .and_local_timezone(chrono::Local)
        .earliest()
        .map(|local| local.with_timezone(&Utc))
        .unwrap_or_else(midnight)
}

/// 半开区间相减：`slots` 去掉 `[cut_start, cut_end)`
fn subtract(
    slots: Vec<Interval>,
    cut_start: DateTime<Utc>,
    cut_end: DateTime<Utc>,
) -> Vec<Interval> {
    let mut out = Vec::new();
    for (start, end) in slots {
        if cut_end <= start || cut_start >= end {
            // 不相交，原样保留
            out.push((start, end));
            continue;
        }
        if start < cut_start {
            out.push((start, cut_start));
        }
        if cut_end < end {
            out.push((cut_end, end));
        }
    }
    out
}

/// 找最早一段够长的空闲（15 分钟对齐），并把它**从空闲集里扣掉**
fn first_fit(free: &mut Vec<Interval>, minutes: i64) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    // 按起点排的索引（索引本身由 `enumerate` 生成，`get` 兜底）
    let mut order: Vec<usize> = (0..free.len()).collect();
    order.sort_by_key(|i| {
        free.get(*i)
            .map(|(s, _)| *s)
            .unwrap_or(DateTime::<Utc>::MIN_UTC)
    });
    for i in order {
        let Some(&(start, end)) = free.get(i) else {
            continue;
        };
        // 起点对齐到 15 分钟网格：人安排一件事的时间就在这四档上
        let aligned = snap_up(start);
        if minute_len(aligned, end) >= minutes {
            let chosen_end = aligned + Duration::minutes(minutes);
            free.remove(i);
            return Some((aligned, chosen_end));
        }
    }
    None
}

/// 向上取到 15 分钟网格
fn snap_up(at: DateTime<Utc>) -> DateTime<Utc> {
    let minute = at.minute() as i64;
    let rem = minute % SLOT_GRANULARITY_MINUTES;
    if rem == 0 && at.second() == 0 {
        at.with_second(0).unwrap_or(at)
    } else {
        let delta = SLOT_GRANULARITY_MINUTES - rem;
        at.with_second(0).unwrap_or(at) + Duration::minutes(delta)
    }
}

/// 展开循环窗口并截到上限 —— 建议算法读 `planned`/`actual` 时用它（§3.4）
///
/// `time_window::expand_between` 自己的上限是 500；这里用 52（≈ 一年的周重复），
/// 超了就 warn：说明数据的递归规则有问题，该说破而不是默默截断。
pub fn expand_capped(
    window: &crate::modules::time_window::TimeWindow,
    horizon: DateTime<Utc>,
) -> Vec<Interval> {
    let expanded = window.expand_between(horizon, MAX_EXPANDED_SEGMENTS + 1);
    if expanded.len() > MAX_EXPANDED_SEGMENTS {
        tracing::warn!(
            task_id = window.task_id,
            segments = expanded.len(),
            cap = MAX_EXPANDED_SEGMENTS,
            "循环窗口展开超上限，已截断：建议只覆盖接下来几天"
        );
    }
    expanded.into_iter().take(MAX_EXPANDED_SEGMENTS).collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use chrono::TimeZone;

    fn ts(y: i32, m: u32, d: u32, h: u32, min: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(y, m, d, h, min, 0).unwrap()
    }

    /// 候选：最小可用形状
    fn cand(id: i32, title: &str, ranked: Ranked) -> Candidate {
        Candidate {
            task_id: id,
            title: title.into(),
            ranked,
            effort_minutes: None,
            due_at: None,
            blocked_by: None,
        }
    }

    fn ranked(id: i32) -> Ranked {
        Ranked {
            task_id: id,
            score: 1.0,
            reasons: vec![super::super::ranking::Reason {
                kind: super::super::ranking::ReasonKind::Inbox,
                weight: 1.0,
                detail: "收件箱".into(),
            }],
            is_active: false,
            updated_at: ts(2026, 9, 1, 0, 0),
            created_at: ts(2026, 9, 1, 0, 0),
        }
    }

    /// 固定的工作时段：一天 09:00–18:00 整段，去掉跨午休与周末的干扰
    fn all_day_hours() -> WorkingHours {
        WorkingHours {
            ranges: vec![TimeRange {
                start_minute: 9 * 60,
                end_minute: 18 * 60,
            }],
            weekdays: vec![1, 2, 3, 4, 5, 6, 7],
            max_slot_minutes: 120,
        }
    }

    /// 2026-10-05 是周一
    const MONDAY: (i32, u32, u32) = (2026, 10, 5);

    /**
     * **本地**时刻 → UTC。
     *
     * 工作时段是本地钟点（"我 9 点开始工作"），所以区间与断言都得按本地日构造 ——
     * 直接写 UTC 串会在非 UTC 时区上把断言推到工作时段之外（本项目在 UTC+8 上跑）。
     */
    fn local_ts(day: u32, hour: u32, minute: u32) -> DateTime<Utc> {
        chrono::NaiveDate::from_ymd_opt(MONDAY.0, MONDAY.1, day)
            .expect("合法日期")
            .and_hms_opt(hour, minute, 0)
            .expect("合法时刻")
            .and_local_timezone(chrono::Local)
            .earliest()
            .expect("本地时刻存在")
            .with_timezone(&Utc)
    }

    /// 区间 [from_day 00:00, to_day 00:00)，按本地日对齐
    fn range_for(from_day: u32, to_day: u32) -> (DateTime<Utc>, DateTime<Utc>) {
        (local_ts(from_day, 0, 0), local_ts(to_day, 0, 0))
    }

    /// 「某天 00:00」（用于 due 已过期的场景）
    fn local_start_of(day: u32) -> DateTime<Utc> {
        local_ts(day, 0, 0)
    }

    #[test]
    fn packs_into_the_earliest_free_slot() {
        let (from, to) = range_for(5, 6);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: vec![cand(1, "写周报", ranked(1))],
            ..Default::default()
        };
        let mut candidate = ctx.candidates[0].clone();
        candidate.effort_minutes = Some(60);

        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert_eq!(result.suggestions.len(), 1);
        let s = &result.suggestions[0];
        assert_eq!(s.effort_minutes, 60);
        // 起点落在工作时段内且对齐 15 分钟
        assert_eq!(s.start.minute() % 15, 0);
        assert_eq!((s.end - s.start).num_minutes(), 60);
    }

    #[test]
    fn avoids_busy_intervals() {
        let (from, to) = range_for(5, 6);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            busy: vec![(local_ts(5, 9, 0), local_ts(5, 12, 0))],
            candidates: vec![cand(1, "写周报", ranked(1))],
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert_eq!(result.suggestions.len(), 1);
        // 09:00–12:00 被占，落点必须在 12:00 之后
        assert!(result.suggestions[0].start >= local_ts(5, 12, 0));
    }

    #[test]
    fn first_fit_does_not_span_the_lunch_break() {
        // 默认工作时段：09:00-12:00 + 14:00-18:00（午休 12:00-14:00 不在工作时段里）
        let (from, to) = range_for(5, 6);
        let mut candidate = cand(1, "写周报", ranked(1));
        candidate.effort_minutes = Some(150);
        let ctx = SlotContext {
            working_hours: WorkingHours::default(),
            candidates: vec![candidate],
            ..Default::default()
        };

        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert_eq!(result.suggestions.len(), 1);
        let s = &result.suggestions[0];
        // 150 分钟塞不进 09:00-12:00（180 分），也不该跨午休拼成 12:00-14:30
        assert!(
            s.start >= local_ts(5, 14, 0) || s.end <= local_ts(5, 12, 0),
            "不该跨午休拼接：{:?} – {:?}",
            s.start,
            s.end
        );
    }

    #[test]
    fn unscheduled_with_blocked_dependency_says_who() {
        let (from, to) = range_for(5, 6);
        let mut candidate = cand(2, "读论文", ranked(2));
        candidate.blocked_by = Some("写周报".into());
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: vec![candidate],
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert!(result.suggestions.is_empty());
        assert_eq!(result.unscheduled.len(), 1);
        assert_eq!(result.unscheduled[0].reason, "等「写周报」完成");
    }

    #[test]
    fn unscheduled_when_capacity_is_full() {
        let (from, to) = range_for(5, 6);
        // 区间只有 5 号一天 09:00–18:00 = 540 分钟；排 5 条 120 分钟的正好排满
        let mut candidates = Vec::new();
        for id in 1..=5 {
            let mut c = cand(id, &format!("任务 {id}"), ranked(id));
            c.effort_minutes = Some(120);
            candidates.push(c);
        }
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates,
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        // S6-f：宁可少给，不塞满；排不下的要说清
        assert!(
            result
                .unscheduled
                .iter()
                .any(|u| u.reason == "这段时间排不下了")
        );
        assert_eq!(result.capacity.total_minutes, 540);
    }

    #[test]
    fn unscheduled_when_due_is_before_the_range() {
        let (from, to) = range_for(5, 6);
        let mut candidate = cand(3, "过期的事", ranked(3));
        candidate.due_at = Some(local_start_of(1));
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: vec![candidate],
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert!(result.suggestions.is_empty());
        assert_eq!(result.unscheduled[0].reason, "截止日期在这段时间之外");
    }

    #[test]
    fn confidence_levels_follow_the_table() {
        let (from, to) = range_for(5, 8);
        let now = ts(2026, 10, 5, 0, 0);

        // high：有明确 due + 时长是用户给的
        let mut high = cand(1, "写周报", ranked(1));
        high.effort_minutes = Some(60);
        high.due_at = Some(ts(2026, 10, 6, 0, 0));

        // low：时长是估的
        let mut low = cand(2, "读点什么", ranked(2));
        low.due_at = Some(ts(2026, 10, 6, 0, 0));

        // medium：时长被上限截断
        let mut medium = cand(3, "大任务", ranked(3));
        medium.effort_minutes = Some(600);
        medium.due_at = Some(ts(2026, 10, 6, 0, 0));

        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: vec![high, low, medium],
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, now);
        let by_id = |id: i32| {
            result
                .suggestions
                .iter()
                .find(|s| s.task_id == id)
                .map(|s| s.confidence)
        };
        assert_eq!(by_id(1), Some(Confidence::High));
        assert_eq!(by_id(2), Some(Confidence::Low));
        assert_eq!(by_id(3), Some(Confidence::Medium));
        // 截断到上限
        assert_eq!(
            result
                .suggestions
                .iter()
                .find(|s| s.task_id == 3)
                .map(|s| s.effort_minutes),
            Some(120)
        );
    }

    #[test]
    fn capacity_accounting_is_transparent() {
        let (from, to) = range_for(5, 6);
        let mut candidate = cand(1, "写周报", ranked(1));
        candidate.effort_minutes = Some(60);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            busy: vec![(local_ts(5, 9, 0), local_ts(5, 9, 30))],
            candidates: vec![candidate],
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        // 一天 × 9 小时工作时段 = 540 总容量；已占 30；建议 60
        assert_eq!(result.capacity.total_minutes, 540);
        assert_eq!(result.capacity.used_minutes, 30);
        assert_eq!(result.capacity.suggested_minutes, 60);
    }

    #[test]
    fn weekday_filter_excludes_weekends() {
        // 只有周一至周五
        let (from, to) = range_for(3, 8); // 周六 → 下周三
        let ctx = SlotContext {
            working_hours: WorkingHours::default(),
            candidates: vec![cand(1, "写周报", ranked(1))],
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 3, 0, 0));
        assert_eq!(result.suggestions.len(), 1);
        // 落点必须在工作日
        let weekday = result.suggestions[0].start.weekday().num_days_from_monday() as u8;
        assert!(
            weekday <= 4,
            "落到了周末：{:?}",
            result.suggestions[0].start
        );
    }

    #[test]
    fn busy_half_open_boundaries_do_not_block() {
        // C002 的约定：边界相接不算重叠（10:00 结束 / 10:00 开始）
        let (from, to) = range_for(5, 6);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            busy: vec![(local_ts(5, 9, 0), local_ts(5, 10, 0))],
            candidates: vec![cand(1, "写周报", ranked(1))],
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        // 第一个可用空档是 10:00，紧接上一个占用之后
        assert_eq!(result.suggestions[0].start, local_ts(5, 10, 0));
    }

    #[test]
    fn every_suggestion_aligns_to_the_grid() {
        let (from, to) = range_for(5, 6);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: (1..=5)
                .map(|id| cand(id, &format!("任务 {id}"), ranked(id)))
                .collect(),
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        for s in &result.suggestions {
            assert_eq!(s.start.minute() % 15, 0, "起点没对齐：{:?}", s.start);
            assert_eq!(s.end.minute() % 15, 0, "终点没对齐：{:?}", s.end);
        }
    }

    #[test]
    fn zero_effort_falls_back_to_an_estimate_marked_low() {
        let (from, to) = range_for(5, 6);
        let mut candidate = cand(1, "读点什么", ranked(1));
        candidate.effort_minutes = Some(0);
        let ctx = SlotContext {
            working_hours: all_day_hours(),
            candidates: vec![candidate],
            ..Default::default()
        };
        let result = suggest(&ctx, from, to, ts(2026, 10, 5, 0, 0));
        assert_eq!(result.suggestions[0].confidence, Confidence::Low);
        assert!(result.suggestions[0].effort_minutes > 0);
    }
}
