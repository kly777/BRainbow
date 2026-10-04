//! 任务排序：**加权乘积 + 可解释的理由**（P8）。
//!
//! 形状沿用项目内已验证的那一套（`modules/mem/selection.rs` 的 `review_candidate_weight`）：
//! 几个因子相乘，每个因子都对应一句人话。**没有理由的排序不允许上线** —— 所以
//! [`Ranked::reasons`] 恒非空（无信息时给"收件箱"那条兜底理由）。
//!
//! ```text
//! score = due_factor × priority_factor × blocked_factor × aging_factor
//! ```
//!
//! 四个因子都是**用户表达过的**信息：系统不猜测，也就不用解释"我为什么猜这个"。
//! 因子全为 1.0（平局）时不是往分数里掺噪声，而是走一组稳定的次级键（[`sort_ranked`]）。
//!
//! 为什么不用连续衰减：`mem` 那边用 `(1+days)^-1` 是合理的（记忆越近越该复习），
//! 但任务有**完成**这个离散终点 —— 远期任务今天做和 5 天后做没有本质区别，所以
//! 远期**塌缩到常数**（0.4）而不是持续衰减；同理逾期分段封顶（9.0），否则积压 20 天的
//! 任务会永远压在新任务前面（"陈旧任务饿死"）。

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Duration, Utc};

use super::model::{Task, TaskStatus};

/// 依赖可达性的深度上限：`task_dependency` 允许成环（A→B→A 能写进库），
/// 超限即判定成环 —— 与 `time_window::expand_between` 的单窗上限 500 同类思路。
///
/// 超过它的**不是**"未阻塞"而是"依赖成环"：把数据错误说成没问题，等于让排序器一直撒谎。
pub const MAX_DEP_DEPTH: usize = 16;

/// 一条理由：哪一种因子、贡献多大、中文怎么说
#[derive(Debug, Clone, PartialEq)]
pub struct Reason {
    pub kind: ReasonKind,
    /// 该因子的乘数（`1.0` = 无影响）
    pub weight: f64,
    /// 面向用户的中文短语，如"逾期 2 天"
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReasonKind {
    Overdue,
    DueToday,
    DueSoon,
    /// 8 天以上：远期不占前排
    DueFar,
    Priority,
    Blocked,
    /// 依赖成环（数据错误，压到最后并把它说破）
    Cyclic,
    Aging,
    /// 无任何信息时的兜底（保证 `reasons` 非空）
    Inbox,
}

/// 一条任务的打分结果
#[derive(Debug, Clone, PartialEq)]
pub struct Ranked {
    pub task_id: i32,
    pub score: f64,
    /// 参与打分的因子（按贡献从大到小），**恒非空**
    pub reasons: Vec<Reason>,
    // ── 次级键（打平时用）：为了让排序自包含，这里带上它们的取值 ──
    /// `status = 'active'`：用户已经动手的，先做完
    pub is_active: bool,
    pub updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

impl Ranked {
    /// 界面显示的一行理由：`今天到期 · 标为 p1`
    ///
    /// 只取贡献最大的前两条 —— 三条以上堆在一行里没人看，而排序结果本身已经足够
    /// 说明问题（P8 要的是"能解释"，不是"写满一整行"）。
    pub fn summary(&self) -> String {
        self.reasons
            .iter()
            .take(2)
            .map(|reason| reason.detail.as_str())
            .collect::<Vec<_>>()
            .join(" · ")
    }

    /// 供 API 响应的理由短语（顺序即贡献顺序）
    pub fn details(&self) -> Vec<String> {
        self.reasons
            .iter()
            .map(|reason| reason.detail.clone())
            .collect()
    }
}

/// 一条前置依赖：标题与"是否还没完成"（理由文案要用标题）
#[derive(Debug, Clone)]
pub struct DependencyEdge {
    pub depends_on_id: i32,
    pub title: String,
    pub is_open: bool,
}

/// 打分用的上下文：依赖图（其余因子都在任务自己身上）
#[derive(Debug, Default, Clone)]
pub struct RankContext {
    /// task_id → 它的前置依赖列表
    edges: HashMap<i32, Vec<DependencyEdge>>,
}

impl RankContext {
    pub fn new(edges: HashMap<i32, Vec<DependencyEdge>>) -> Self {
        Self { edges }
    }
}

/// 阻塞状态（含成环）
enum BlockState {
    Clear,
    Blocked { title: String },
    Cyclic,
}

impl RankContext {
    /// 依赖阻塞：成环优先于"有未完成的前置"（成环是数据错误，说破它比说"等谁完成"更重要）
    fn block_state(&self, task_id: i32) -> BlockState {
        if self.reaches_cycle(task_id) {
            return BlockState::Cyclic;
        }
        match self
            .edges
            .get(&task_id)
            .and_then(|deps| deps.iter().find(|edge| edge.is_open))
        {
            Some(edge) => BlockState::Blocked {
                title: edge.title.clone(),
            },
            None => BlockState::Clear,
        }
    }

    /// 从 `task_id` 出发沿依赖边走，遇到重复节点或超过深度上限即判定成环
    fn reaches_cycle(&self, task_id: i32) -> bool {
        fn walk(ctx: &RankContext, current: i32, path: &mut HashSet<i32>, depth: usize) -> bool {
            if depth > MAX_DEP_DEPTH {
                return true; // 太深了，当作环（而不是当作没问题）
            }
            if !path.insert(current) {
                return true; // 回到路径上已有的节点 = 环
            }
            let cyclic = ctx
                .edges
                .get(&current)
                .map(|deps| {
                    deps.iter()
                        .any(|edge| walk(ctx, edge.depends_on_id, path, depth + 1))
                })
                .unwrap_or(false);
            path.remove(&current);
            cyclic
        }
        walk(self, task_id, &mut HashSet::new(), 0)
    }
}

/// 打分：`score = due × priority × blocked × aging`，并带上理由。
pub fn task_score(task: &Task, now: DateTime<Utc>, ctx: &RankContext) -> Ranked {
    let mut reasons = Vec::new();

    // ── 因子 1：截止时间（权重最高的自然因子）──
    let due_factor = match task.due_at {
        None => 1.0,
        Some(due) => {
            if same_local_day(due, now) {
                // 今天到期：今天还没过完，甚至今天早些时候的点也算"今天"
                // （用户的日历直觉是这样；按"已过点就逾期"会把上午的小事在下午说成逾期）
                reasons.push(Reason {
                    kind: ReasonKind::DueToday,
                    weight: 2.5,
                    detail: "今天到期".into(),
                });
                2.5
            } else if due < now {
                // 逾期：2.0 + 0.5×天数，封顶 9.0（分段而非连续，见模块注释）
                let days = (now - due).num_days().max(1);
                let weight = 2.0 + 0.5 * days.min(14) as f64;
                reasons.push(Reason {
                    kind: ReasonKind::Overdue,
                    weight,
                    detail: format!("逾期 {days} 天"),
                });
                weight
            } else {
                let days = ((due - now).num_hours() as f64 / 24.0).ceil().max(1.0);
                let (weight, detail) = if days <= 3.0 {
                    (2.0 - 0.3 * days, format!("还剩 {} 天", days as i64))
                } else if days <= 7.0 {
                    (1.0 - 0.1 * (days - 3.0), format!("还剩 {} 天", days as i64))
                } else {
                    // 远期塌缩到常数 0.4：任务有"完成"这个离散终点，8 天后做和 30 天后做
                    // 没有本质区别，持续衰减等于让远期任务永远排不上
                    (0.4, due.format("%m-%d").to_string())
                };
                reasons.push(Reason {
                    kind: if days <= 7.0 {
                        ReasonKind::DueSoon
                    } else {
                        ReasonKind::DueFar
                    },
                    weight,
                    detail,
                });
                weight
            }
        }
    };

    // ── 因子 2：手动优先级 ──
    // NULL(1.0) 刻意落在 p3(1.15) 与 p4(0.8) 之间：未表达过的不该系统性压过用户标的 p4，
    // 也不该被用户标的 p3 压住。
    let priority_factor = match task.priority {
        Some(priority) => {
            let weight = match priority {
                super::model::TaskPriority::P1 => 2.0,
                super::model::TaskPriority::P2 => 1.5,
                super::model::TaskPriority::P3 => 1.15,
                super::model::TaskPriority::P4 => 0.8,
            };
            reasons.push(Reason {
                kind: ReasonKind::Priority,
                weight,
                detail: format!("标为 {priority}"),
            });
            weight
        }
        None => 1.0,
    };

    // ── 因子 3：依赖阻塞 ──
    // 0.15 而不是 0：归零等于让它从列表里彻底消失，用户会以为它丢了。
    // 成环（0.1）更低一档：那是数据错误，要压到最后并把它说破。
    let blocked_factor = match ctx.block_state(task.id) {
        BlockState::Clear => 1.0,
        BlockState::Blocked { title } => {
            reasons.push(Reason {
                kind: ReasonKind::Blocked,
                weight: 0.15,
                detail: format!("等「{title}」完成"),
            });
            0.15
        }
        BlockState::Cyclic => {
            reasons.push(Reason {
                kind: ReasonKind::Cyclic,
                weight: 0.1,
                detail: "依赖成环".into(),
            });
            0.1
        }
    };

    // ── 因子 4：陈旧度（很弱的信号：上限 1.15，只在没有 due / 优先级时打破平局）──
    let age_days = (now - task.created_at).num_days();
    let aging_factor = if age_days >= 30 {
        reasons.push(Reason {
            kind: ReasonKind::Aging,
            weight: 1.15,
            detail: format!("在收件箱躺了 {age_days} 天"),
        });
        1.15
    } else if age_days >= 7 {
        let weight = 1.0 + 0.1 * (age_days - 7) as f64 / 23.0;
        reasons.push(Reason {
            kind: ReasonKind::Aging,
            weight,
            detail: format!("在收件箱躺了 {age_days} 天"),
        });
        weight
    } else {
        1.0
    };

    // 兜底：一条信息都没有的任务也要有理由（P8：允许说"只是收件箱里的一条"）
    if reasons.is_empty() {
        reasons.push(Reason {
            kind: ReasonKind::Inbox,
            weight: 1.0,
            detail: "收件箱".into(),
        });
    }
    // 贡献大的排前面（次级键让"贡献"的定义清晰：离 1.0 越远越算贡献）
    reasons.sort_by(|a, b| {
        contribution(b)
            .partial_cmp(&contribution(a))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ranked {
        task_id: task.id,
        score: due_factor * priority_factor * blocked_factor * aging_factor,
        reasons,
        is_active: task.status == TaskStatus::Active,
        updated_at: task.updated_at,
        created_at: task.created_at,
    }
}

/// 一个因子对排序的"贡献"：离中性值 1.0 多远（0.4 与 2.5 一样有话语权）
fn contribution(reason: &Reason) -> f64 {
    (reason.weight - 1.0).abs()
}

/// 按分数排序，打平走稳定次级键 —— **保证全序**（翻页不重不漏）。
///
/// 不用 `==` 比浮点（项目 `deny(float_cmp)`）：`partial_cmp` 在 `NaN` 时返回 `None`，
/// 退化成"当作相等，交给次级键"，正是想要的降级。
pub fn sort_ranked(items: &mut [Ranked]) {
    items.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.is_active.cmp(&a.is_active))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
            .then_with(|| a.created_at.cmp(&b.created_at))
            .then_with(|| a.task_id.cmp(&b.task_id))
    });
}

/// 是不是同一个本地日（"今天到期"要按用户看到的日历算，不是按 UTC 日期）
fn same_local_day(a: DateTime<Utc>, b: DateTime<Utc>) -> bool {
    let a_local = a.with_timezone(&chrono::Local);
    let b_local = b.with_timezone(&chrono::Local);
    a_local.date_naive() == b_local.date_naive()
}

/// "今天到期"的判定还要求 due 在未来（已经过了今天这个钟点的算逾期）
#[allow(dead_code)]
fn is_due_today(due: DateTime<Utc>, now: DateTime<Utc>) -> bool {
    same_local_day(due, now) && due >= now - Duration::zero()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::modules::task::model::TaskPriority;

    fn ts(days_from_now: i64, hours: i64) -> DateTime<Utc> {
        // 固定基准：2026-01-01T00:00:00Z + 偏移
        DateTime::from_timestamp(1_767_225_600 + days_from_now * 86_400 + hours * 3_600, 0).unwrap()
    }

    fn task(id: i32, over: impl FnOnce(&mut Task)) -> Task {
        let mut task = Task {
            id,
            title: format!("任务 {id}"),
            description: None,
            parent_task_id: None,
            status: TaskStatus::Backlog,
            completed_at: None,
            effort_estimate_minutes: None,
            start_at: None,
            due_at: None,
            priority: None,
            created_at: ts(-1, 0),
            updated_at: ts(-1, 0),
        };
        over(&mut task);
        task
    }

    fn ctx_with(edges: Vec<(i32, i32, &str, bool)>) -> RankContext {
        let mut map: HashMap<i32, Vec<DependencyEdge>> = HashMap::new();
        for (task_id, dep_id, title, is_open) in edges {
            map.entry(task_id).or_default().push(DependencyEdge {
                depends_on_id: dep_id,
                title: title.into(),
                is_open,
            });
        }
        RankContext::new(map)
    }

    // ── 四条排序性质（设计文档 §2.2 的表）──

    #[test]
    fn overdue_beats_priority() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        let overdue_p4 = task(1, |t| {
            t.due_at = Some(ts(-3, 0)); // 逾期 3 天
            t.priority = Some(TaskPriority::P4);
        });
        let fresh_p1 = task(2, |t| {
            t.due_at = Some(ts(6, 0)); // 还有 6 天
            t.priority = Some(TaskPriority::P1);
        });
        let a = task_score(&overdue_p4, now, &empty);
        let b = task_score(&fresh_p1, now, &empty);
        assert!(
            a.score > b.score,
            "逾期该压过优先级：逾期 p4 = {} vs 未逾期 p1 = {}",
            a.score,
            b.score
        );
    }

    #[test]
    fn blocked_sinks_but_stays_visible() {
        let now = ts(0, 12);
        let ctx = ctx_with(vec![(1, 99, "写周报", true)]);
        let blocked = task_score(&task(1, |_| {}), now, &ctx);
        let normal = task_score(&task(2, |_| {}), now, &RankContext::default());
        assert!(blocked.score > 0.0, "归零等于从列表里消失，用户会以为丢了");
        assert!(blocked.score < normal.score, "阻塞项该沉底");
        assert!(
            blocked.reasons.iter().any(|r| r.detail.contains("写周报")),
            "理由要说清在等谁：{:?}",
            blocked.reasons
        );
    }

    #[test]
    fn aging_does_not_beat_explicit_p4() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        // 躺了 60 天的 p4 vs 有 p2 标记的新任务
        let old_p4 = task_score(
            &task(1, |t| {
                t.created_at = ts(-60, 0);
                t.priority = Some(TaskPriority::P4);
            }),
            now,
            &empty,
        );
        let fresh_p2 = task_score(
            &task(2, |t| {
                t.created_at = ts(-1, 0);
                t.priority = Some(TaskPriority::P2);
            }),
            now,
            &empty,
        );
        assert!(
            old_p4.score < fresh_p2.score,
            "aging 只是很弱的信号，不该压过用户标的优先级"
        );
    }

    #[test]
    fn ties_fall_through_to_stable_secondary_keys() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        // 同分（都无信息）：older created_at 在前（GTD：先进先清）
        let older = task_score(&task(1, |t| t.created_at = ts(-3, 0)), now, &empty);
        let newer = task_score(&task(2, |t| t.created_at = ts(-1, 0)), now, &empty);
        let mut items = vec![newer, older.clone()];
        sort_ranked(&mut items);
        assert_eq!(items[0].task_id, 1, "同分时最早进收件箱的排前面");

        // active 优先于 backlog
        let active = task_score(
            &task(3, |t| {
                t.status = TaskStatus::Active;
                t.created_at = ts(-1, 0);
            }),
            now,
            &empty,
        );
        let mut items = vec![active, older];
        sort_ranked(&mut items);
        assert_eq!(items[0].task_id, 3, "已经动手的先做完");
    }

    #[test]
    fn full_order_is_deterministic_by_id() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        // 完全同分同时间：靠 id ASC 兜底，顺序与输入顺序无关
        let items = (1..=5)
            .map(|id| task_score(&task(id, |_| {}), now, &empty))
            .collect::<Vec<_>>();
        let mut forward = items.clone();
        let mut backward = items.into_iter().rev().collect::<Vec<_>>();
        sort_ranked(&mut forward);
        sort_ranked(&mut backward);
        let ids = |v: &Vec<Ranked>| v.iter().map(|r| r.task_id).collect::<Vec<_>>();
        assert_eq!(ids(&forward), ids(&backward));
        assert_eq!(ids(&forward), vec![1, 2, 3, 4, 5]);
    }

    // ── 打分表逐档 ──

    #[test]
    fn due_factor_matches_the_table() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        let score_with_due = |days: i64, hours: i64| {
            task_score(&task(1, |t| t.due_at = Some(ts(days, hours))), now, &empty).score
        };
        // 今天到期 = 2.5（同一天、还没到点）
        assert!((score_with_due(0, 5) - 2.5).abs() < 1e-9);
        // 1–3 天 = 2.0 - 0.3×天数
        assert!((score_with_due(1, 12) - 1.7).abs() < 1e-6);
        assert!((score_with_due(3, 12) - 1.1).abs() < 1e-6);
        // 4–7 天 = 1.0 - 0.1×(天数-3)
        assert!((score_with_due(7, 12) - 0.6).abs() < 1e-6);
        // 8 天以上塌缩到 0.4
        assert!((score_with_due(30, 0) - 0.4).abs() < 1e-9);
        // 逾期封顶 9.0
        assert!((score_with_due(-30, 0) - 9.0).abs() < 1e-9);
        // 逾期 1 天 = 2.0 + 0.5 = 2.5，与"今天到期"同分（设计文档的分段表就是这样，
        // 同分交给次级键）；逾期 2 天起就真的更高
        assert!((score_with_due(-1, 0) - 2.5).abs() < 1e-9);
        assert!(score_with_due(-2, 0) > 2.5);
    }

    #[test]
    fn priority_factor_matches_the_table() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        let score_with_priority = |priority: Option<TaskPriority>| {
            task_score(&task(1, |t| t.priority = priority), now, &empty).score
        };
        assert!((score_with_priority(Some(TaskPriority::P1)) - 2.0).abs() < 1e-9);
        assert!((score_with_priority(Some(TaskPriority::P2)) - 1.5).abs() < 1e-9);
        assert!((score_with_priority(Some(TaskPriority::P3)) - 1.15).abs() < 1e-9);
        assert!((score_with_priority(Some(TaskPriority::P4)) - 0.8).abs() < 1e-9);
        // NULL 落在 p3 与 p4 之间
        let null = score_with_priority(None);
        assert!(null < 1.15 && null > 0.8);
    }

    // ── 数据质量防御 ──

    #[test]
    fn cycle_is_reported_as_cycle_not_as_clear() {
        let now = ts(0, 12);
        // A → B → A
        let ctx = ctx_with(vec![(1, 2, "B", true), (2, 1, "A", true)]);
        let ranked = task_score(&task(1, |_| {}), now, &ctx);
        assert!(ranked.score < 0.15, "成环比普通阻塞更低一档");
        assert!(ranked.reasons.iter().any(|r| r.detail == "依赖成环"));
    }

    #[test]
    fn deep_chain_hits_depth_cap_without_panicking() {
        let now = ts(0, 12);
        // 40 级长的链（不构成环）会撞上 MAX_DEP_DEPTH —— 判成环，不是"未阻塞"
        let edges: Vec<(i32, i32, &str, bool)> =
            (1..40).map(|id| (id, id + 1, "下游", false)).collect();
        let ctx = ctx_with(edges);
        let ranked = task_score(&task(1, |_| {}), now, &ctx);
        assert!(ranked.reasons.iter().any(|r| r.detail == "依赖成环"));
        // 且不 panic、不死循环
    }

    #[test]
    fn completed_dependency_does_not_block() {
        let now = ts(0, 12);
        let ctx = ctx_with(vec![(1, 2, "已完成的前置", false)]);
        let ranked = task_score(&task(1, |_| {}), now, &ctx);
        assert!((ranked.score - 1.0).abs() < 1e-9);
        assert!(!ranked.reasons.iter().any(|r| r.detail.contains("前置")));
    }

    // ── 理由 ──

    #[test]
    fn reasons_are_never_empty() {
        let now = ts(0, 12);
        for task in [
            task(1, |_| {}),
            task(2, |t| t.due_at = Some(ts(1, 0))),
            task(3, |t| t.priority = Some(TaskPriority::P1)),
        ] {
            let ranked = task_score(&task, now, &RankContext::default());
            assert!(!ranked.reasons.is_empty(), "无理由的排序不允许上线");
            assert!(!ranked.summary().is_empty());
        }
    }

    #[test]
    fn summary_is_human_readable() {
        let now = ts(0, 12);
        let empty = RankContext::default();
        let ranked = task_score(
            &task(1, |t| {
                t.due_at = Some(ts(0, 5));
                t.priority = Some(TaskPriority::P1);
            }),
            now,
            &empty,
        );
        assert_eq!(ranked.summary(), "今天到期 · 标为 p1");
    }
}
