//! FSRS 间隔重复调度器（基于 fsrs crate v6.6）
//!
//! 状态机：new → learning → review ⇄ relearning
//! 学习步进：[1min, 10min]  重学步进：[10min]
//! Again 始终走 FSRS 降 stability

use crate::modules::mem::model::CardState;
use chrono::{DateTime, Duration, Utc};
use fsrs::{FSRS, MemoryState};
use std::sync::OnceLock;

/// 全局 FSRS 参数，启动时由 `init_global_params` 设置。
static GLOBAL_FSRS_PARAMS: OnceLock<Vec<f32>> = OnceLock::new();

/// 设置全局 FSRS 参数（启动时调用）
pub fn init_global_params(params: Vec<f32>) {
    GLOBAL_FSRS_PARAMS.set(params).ok();
}

/// 获取当前 FSRS 参数
pub fn get_global_params() -> &'static [f32] {
    GLOBAL_FSRS_PARAMS.get().map(|v| v.as_slice()).unwrap_or(&[])
}

// ── 可配置参数 ──

/// 调度器配置：步进、毕业间隔、期望 retention
#[derive(Debug, Clone)]
pub struct SchedulerConfig {
    /// 学习步进（秒）
    pub learning_steps: Vec<i64>,
    /// 重学步进（秒）
    pub relearn_steps: Vec<i64>,
    /// 毕业到 Review 的最小间隔（秒）
    pub graduating_interval_secs: i64,
    /// 期望回忆率
    pub desired_retention: f64,
}

impl Default for SchedulerConfig {
    fn default() -> Self {
        Self {
            learning_steps: vec![60, 600],
            relearn_steps: vec![600],
            graduating_interval_secs: 86400,
            desired_retention: 0.9,
        }
    }
}

// ── 内部函数 ──

fn due_in_secs(secs: i64) -> String {
    (Utc::now() + Duration::seconds(secs))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

fn make_fsrs() -> FSRS {
    FSRS::new(get_global_params()).unwrap()
}

/// 除非有真实的记忆参数，否则传 None（避免 stability=0 / difficulty=0 传给 FSRS）
fn to_memory_state(stability: f64, difficulty: f64) -> Option<MemoryState> {
    if stability <= 0.0 || difficulty <= 0.0 {
        None
    } else {
        Some(MemoryState {
            stability: stability as f32,
            difficulty: difficulty as f32,
        })
    }
}

fn compute_next(
    mem: Option<MemoryState>,
    rating: u8,
    days_elapsed: u32,
    desired_retention: f64,
) -> f64 {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, desired_retention as f32, days_elapsed).unwrap();
    let chosen = match rating {
        1 => &next.again,
        2 => &next.hard,
        3 => &next.good,
        _ => &next.easy,
    };
    (chosen.interval as f64 * 86400.0).max(60.0)
}

fn compute_next_with_state(
    mem: Option<MemoryState>,
    rating: u8,
    days_elapsed: u32,
    desired_retention: f64,
) -> (f64, f64, f64) {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, desired_retention as f32, days_elapsed).unwrap();
    let chosen = match rating {
        1 => &next.again,
        2 => &next.hard,
        3 => &next.good,
        _ => &next.easy,
    };
    let secs = (chosen.interval as f64 * 86400.0).max(60.0);
    (
        chosen.memory.stability as f64,
        chosen.memory.difficulty as f64,
        secs,
    )
}

// ── 公开 API ──

pub struct ReviewOutcome {
    pub state: CardState,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
}

/// 调度一次复习。
///
/// `days_elapsed`：自上次复习至今的天数（整数）。
/// 步进阶段（learning/relearning）传递 0（因步进间隔 < 1 天），
/// 此时步进间不更新 FSRS 状态——仅在毕业时使用实际的累积天数。
///
/// `cumulative_step_days`：自进入当前步进阶段（Learning 或 Relearning）
/// 以来经过的总天数。用于毕业时正确反映实际经过时间。
pub fn schedule(
    s_old: f64,
    d_old: f64,
    state: CardState,
    step_index: Option<usize>,
    rating: u8,
    _now: DateTime<Utc>,
    days_elapsed: u32,
    cumulative_step_days: u32,
    config: &SchedulerConfig,
) -> ReviewOutcome {
    use CardState::*;

    // ── 重学阶段 ──
    if state == Relearning {
        return relearn(
            s_old, d_old, step_index.unwrap_or(0), rating, days_elapsed,
            cumulative_step_days, config,
        );
    }

    // ── 学习阶段 ──
    if state == Learning || state == New {
        let step = if state == New {
            0
        } else {
            step_index.unwrap_or(0)
        };
        let steps = &config.learning_steps;
        let total_steps = steps.len();
        let mem = to_memory_state(s_old, d_old);

        return match rating {
            1 => {
                // Again：用 FSRS 更新状态，回到 step 0
                let (s, d, _) = compute_next_with_state(mem, 1, days_elapsed, config.desired_retention);
                ReviewOutcome {
                    state: Learning,
                    stability: s,
                    difficulty: d,
                    due_at: due_in_secs(steps[0]),
                }
            }
            2 => {
                // Hard：保持 S/D 不变，留在当前步进
                let secs = steps[step.min(total_steps - 1)];
                ReviewOutcome {
                    state: Learning,
                    stability: s_old,
                    difficulty: d_old,
                    due_at: due_in_secs(secs),
                }
            }
            _ => {
                let next = step + 1;
                if next >= total_steps {
                    // 毕业 → Review：使用累积时间
                    let (s, d, secs) = compute_next_with_state(
                        mem, rating, cumulative_step_days, config.desired_retention,
                    );
                    let secs = secs.max(config.graduating_interval_secs as f64);
                    ReviewOutcome {
                        state: Review,
                        stability: s,
                        difficulty: d,
                        due_at: due_in_secs(secs as i64),
                    }
                } else {
                    // 推进到下一步：不调 FSRS，S/D 保持不变（毕业时用累积时间算）
                    ReviewOutcome {
                        state: Learning,
                        stability: s_old,
                        difficulty: d_old,
                        due_at: due_in_secs(steps[next]),
                    }
                }
            }
        };
    }

    // ── 复习阶段 ──
    let mem = to_memory_state(s_old, d_old);

    if rating == 1 {
        let (s, d, _) = compute_next_with_state(mem, 1, days_elapsed, config.desired_retention);
        return ReviewOutcome {
            state: Relearning,
            stability: s,
            difficulty: d,
            due_at: due_in_secs(config.relearn_steps[0]),
        };
    }

    let (s, d, secs) = compute_next_with_state(mem, rating, days_elapsed, config.desired_retention);
    ReviewOutcome {
        state: Review,
        stability: s,
        difficulty: d,
        due_at: due_in_secs(secs as i64),
    }
}

fn relearn(
    s_old: f64,
    d_old: f64,
    step: usize,
    rating: u8,
    days_elapsed: u32,
    cumulative_step_days: u32,
    config: &SchedulerConfig,
) -> ReviewOutcome {
    let mem = to_memory_state(s_old, d_old);
    let steps = &config.relearn_steps;
    let total_steps = steps.len();
    use CardState::*;

    match rating {
        1 => {
            let (s, d, _) = compute_next_with_state(mem, 1, days_elapsed, config.desired_retention);
            ReviewOutcome {
                state: Relearning,
                stability: s,
                difficulty: d,
                due_at: due_in_secs(steps[0]),
            }
        }
        2 => {
            let secs = steps[step.min(total_steps - 1)];
            ReviewOutcome {
                state: Relearning,
                stability: s_old,
                difficulty: d_old,
                due_at: due_in_secs(secs),
            }
        }
        _ => {
            let next = step + 1;
            if next >= total_steps {
                let (s, d, secs) = compute_next_with_state(
                    mem, rating, cumulative_step_days, config.desired_retention,
                );
                ReviewOutcome {
                    state: Review,
                    stability: s,
                    difficulty: d,
                    due_at: due_in_secs(secs as i64),
                }
            } else {
                ReviewOutcome {
                    state: Relearning,
                    stability: s_old,
                    difficulty: d_old,
                    due_at: due_in_secs(steps[next]),
                }
            }
        }
    }
}

pub fn preview(
    s_old: f64,
    d_old: f64,
    state: CardState,
    step_index: Option<usize>,
    days_elapsed: u32,
    config: &SchedulerConfig,
) -> [f64; 4] {
    let mem = to_memory_state(s_old, d_old);
    use CardState::*;

    if state == Relearning {
        let steps = &config.relearn_steps;
        let step = step_index.unwrap_or(0);
        return [
            steps[0] as f64,
            steps[step.min(steps.len() - 1)] as f64,
            if step + 1 >= steps.len() {
                compute_next(mem, 3, days_elapsed, config.desired_retention)
            } else {
                steps[step + 1] as f64
            },
            if step + 1 >= steps.len() {
                compute_next(mem, 4, days_elapsed, config.desired_retention)
            } else {
                steps[step + 1] as f64
            },
        ];
    }

    if state == Learning || state == New {
        let steps = &config.learning_steps;
        let step = if state == New {
            0
        } else {
            step_index.unwrap_or(0)
        };
        let again = steps[0] as f64;
        let hard = steps[step.min(steps.len() - 1)] as f64;
        let next = step + 1;
        let (good, easy) = if next >= steps.len() {
            (compute_next(mem, 3, days_elapsed, config.desired_retention),
             compute_next(mem, 4, days_elapsed, config.desired_retention))
        } else {
            (steps[next] as f64, steps[next] as f64)
        };
        return [again, hard, good, easy];
    }

    [
        config.learning_steps[0] as f64,
        compute_next(mem, 2, days_elapsed, config.desired_retention),
        compute_next(mem, 3, days_elapsed, config.desired_retention),
        compute_next(mem, 4, days_elapsed, config.desired_retention),
    ]
}


#[cfg(test)]
mod tests;
