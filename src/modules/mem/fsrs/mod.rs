//! FSRS 间隔重复调度器（基于 fsrs crate v6.6）
//!
//! 状态机：new → learning → review ⇄ relearning
//! 学习步进：[1min, 10min]  重学步进：[10min]
//! Again 始终走 FSRS 降 stability

use crate::modules::mem::model::CardState;
use chrono::{Duration, Utc};
use fsrs::{FSRS, MemoryState};
use std::sync::RwLock;

/// 全局 FSRS 参数，启动时由 `init_global_params` 设置，
/// 优化后可运行时更新（不重启即生效）。
static GLOBAL_FSRS_PARAMS: RwLock<Vec<f32>> = RwLock::new(Vec::new());

/// 设置全局 FSRS 参数（启动时调用）
pub fn init_global_params(params: Vec<f32>) {
    if let Ok(mut p) = GLOBAL_FSRS_PARAMS.write() {
        *p = params;
    }
}

/// 运行时更新全局 FSRS 参数（优化后调用）
pub fn set_global_params(params: Vec<f32>) {
    let count = params.len();
    if let Ok(mut p) = GLOBAL_FSRS_PARAMS.write() {
        *p = params;
    }
    tracing::info!("FSRS 参数已运行时更新 ({count} 个)");
}

/// 获取当前 FSRS 参数（返回空 Vec 表示用默认值）
pub fn get_global_params() -> Vec<f32> {
    GLOBAL_FSRS_PARAMS
        .read()
        .ok()
        .map(|p| p.clone())
        .unwrap_or_default()
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
            graduating_interval_secs: 7200,
            desired_retention: 0.9,
        }
    }
}

// ── 内部函数 ──

fn due_in_secs(secs: i64) -> String {
    (Utc::now() + Duration::seconds(secs))
        .format("%Y-%m-%dT%H:%M:%S+00:00")
        .to_string()
}

fn make_fsrs() -> Result<FSRS, String> {
    let params = get_global_params();
    FSRS::new(&params).map_err(|e| format!("FSRS 参数非法: {e}"))
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
) -> Result<f64, String> {
    let fsrs = make_fsrs()?;
    let next = fsrs
        .next_states(mem, desired_retention as f32, days_elapsed)
        .map_err(|e| format!("FSRS next_states 失败: {e}"))?;
    let chosen = match rating {
        1 => &next.again,
        2 => &next.hard,
        3 => &next.good,
        _ => &next.easy,
    };
    Ok((chosen.interval as f64 * 86400.0).max(60.0))
}

fn compute_next_with_state(
    mem: Option<MemoryState>,
    rating: u8,
    days_elapsed: u32,
    desired_retention: f64,
) -> Result<(f64, f64, f64), String> {
    let fsrs = make_fsrs()?;
    let next = fsrs
        .next_states(mem, desired_retention as f32, days_elapsed)
        .map_err(|e| format!("FSRS next_states 失败: {e}"))?;
    let chosen = match rating {
        1 => &next.again,
        2 => &next.hard,
        3 => &next.good,
        _ => &next.easy,
    };
    let secs = (chosen.interval as f64 * 86400.0).max(60.0);
    Ok((
        chosen.memory.stability as f64,
        chosen.memory.difficulty as f64,
        secs,
    ))
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
/// FSRS 调度输入参数。
pub struct ScheduleInput {
    pub s_old: f64,
    pub d_old: f64,
    pub state: CardState,
    pub step_index: Option<usize>,
    pub rating: u8,
    pub days_elapsed: u32,
    pub cumulative_step_days: u32,
}

pub fn schedule(input: ScheduleInput, config: &SchedulerConfig) -> Result<ReviewOutcome, String> {
    use CardState::*;
    let ScheduleInput {
        s_old,
        d_old,
        state,
        step_index,
        rating,
        days_elapsed,
        cumulative_step_days,
    } = input;

    // 挂起状态不应进入调度（安全兜底）
    if state == Suspended {
        return Ok(ReviewOutcome {
            state: Suspended,
            stability: s_old,
            difficulty: d_old,
            due_at: chrono::Utc::now()
                .format("%Y-%m-%dT%H:%M:%S+00:00")
                .to_string(),
        });
    }

    // ── 重学阶段 ──
    if state == Relearning {
        return relearn(
            s_old,
            d_old,
            step_index.unwrap_or(0),
            rating,
            days_elapsed,
            cumulative_step_days,
            config,
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

        return Ok(match rating {
            1 => {
                // Again：用 FSRS 更新状态，回到 step 0
                let (s, d, _) =
                    compute_next_with_state(mem, 1, days_elapsed, config.desired_retention)?;
                ReviewOutcome {
                    state: Learning,
                    stability: s,
                    difficulty: d,
                    due_at: due_in_secs(*steps.first().unwrap_or(&0)),
                }
            }
            2 => {
                // Hard：保持 S/D 不变，留在当前步进
                let secs = steps.get(step.min(total_steps - 1)).copied().unwrap_or(0);
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
                    // 毕业 → Review：使用累积时间。
                    // 不足 1 天时按 1 天计算，避免几秒/几分钟内连续 Good
                    // 就给出过短的毕业间隔（短期记忆尚未巩固）。
                    let (s, d, secs) = compute_next_with_state(
                        mem,
                        rating,
                        cumulative_step_days.max(1),
                        config.desired_retention,
                    )?;
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
                        due_at: due_in_secs(steps.get(next).copied().unwrap_or(0)),
                    }
                }
            }
        });
    }

    // ── 复习阶段 ──
    let mem = to_memory_state(s_old, d_old);

    if rating == 1 {
        let (s, d, _) = compute_next_with_state(mem, 1, days_elapsed, config.desired_retention)?;
        return Ok(ReviewOutcome {
            state: Relearning,
            stability: s,
            difficulty: d,
            due_at: due_in_secs(*config.relearn_steps.first().unwrap_or(&0)),
        });
    }

    let (s, d, secs) =
        compute_next_with_state(mem, rating, days_elapsed, config.desired_retention)?;
    Ok(ReviewOutcome {
        state: Review,
        stability: s,
        difficulty: d,
        due_at: due_in_secs(secs as i64),
    })
}

fn relearn(
    s_old: f64,
    d_old: f64,
    step: usize,
    rating: u8,
    days_elapsed: u32,
    cumulative_step_days: u32,
    config: &SchedulerConfig,
) -> Result<ReviewOutcome, String> {
    let mem = to_memory_state(s_old, d_old);
    let steps = &config.relearn_steps;
    let total_steps = steps.len();
    use CardState::*;

    Ok(match rating {
        1 => {
            let (s, d, _) =
                compute_next_with_state(mem, 1, days_elapsed, config.desired_retention)?;
            ReviewOutcome {
                state: Relearning,
                stability: s,
                difficulty: d,
                due_at: due_in_secs(*steps.first().unwrap_or(&0)),
            }
        }
        2 => {
            let secs = steps.get(step.min(total_steps - 1)).copied().unwrap_or(0);
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
                // 与学习毕业同理：步进期不足 1 天按 1 天算，且至少尊重毕业间隔
                let (s, d, secs) = compute_next_with_state(
                    mem,
                    rating,
                    cumulative_step_days.max(1),
                    config.desired_retention,
                )?;
                let secs = secs.max(config.graduating_interval_secs as f64);
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
                    due_at: due_in_secs(steps.get(next).copied().unwrap_or(0)),
                }
            }
        }
    })
}

/// Relearning 步进的最低停留时间保护。
///
/// 前端会话内重插会让「几秒前刚点过 Again」的卡再次出现；此时点 Good/Easy
/// 不应视为通过了 10 分钟的重学步进。若距上次复习不足当前步进间隔，返回
/// 还需要等待的秒数（服务层据此把卡留在 Relearning）。
pub fn relearn_min_step_remaining(
    step_index: Option<usize>,
    rating: u8,
    elapsed_secs: i64,
    config: &SchedulerConfig,
) -> Option<i64> {
    if rating < 3 {
        return None;
    }
    let step = step_index.unwrap_or(0);
    let required = config
        .relearn_steps
        .get(step)
        .copied()
        .or_else(|| config.relearn_steps.last().copied())
        .unwrap_or(0);
    if required <= 0 || elapsed_secs >= required {
        None
    } else {
        Some(required - elapsed_secs)
    }
}

pub fn preview(
    s_old: f64,
    d_old: f64,
    state: CardState,
    step_index: Option<usize>,
    days_elapsed: u32,
    elapsed_secs: i64,
    config: &SchedulerConfig,
) -> Result<[f64; 4], String> {
    let mem = to_memory_state(s_old, d_old);
    use CardState::*;

    // 挂起状态返回空间隔
    if state == Suspended {
        return Ok([0.0, 0.0, 0.0, 0.0]);
    }

    if state == Relearning {
        let steps = &config.relearn_steps;
        let step = step_index.unwrap_or(0);
        // 与 schedule 的保护一致：步进时间未走完时，Good/Easy 显示剩余等待秒数
        let early_remaining = relearn_min_step_remaining(step_index, 3, elapsed_secs, config);
        let (good, easy) = if let Some(remaining) = early_remaining {
            (remaining as f64, remaining as f64)
        } else if step + 1 >= steps.len() {
            (
                compute_next(mem, 3, days_elapsed.max(1), config.desired_retention)?,
                compute_next(mem, 4, days_elapsed.max(1), config.desired_retention)?,
            )
        } else {
            (
                steps.get(step + 1).copied().unwrap_or(0) as f64,
                steps.get(step + 1).copied().unwrap_or(0) as f64,
            )
        };
        return Ok([
            *steps.first().unwrap_or(&0) as f64,
            steps.get(step.min(steps.len() - 1)).copied().unwrap_or(0) as f64,
            good,
            easy,
        ]);
    }

    if state == Learning || state == New {
        let steps = &config.learning_steps;
        let step = if state == New {
            0
        } else {
            step_index.unwrap_or(0)
        };
        let again = *steps.first().unwrap_or(&0) as f64;
        let hard = steps.get(step.min(steps.len() - 1)).copied().unwrap_or(0) as f64;
        let next = step + 1;
        let (good, easy) = if next >= steps.len() {
            (
                compute_next(mem, 3, days_elapsed.max(1), config.desired_retention)?,
                compute_next(mem, 4, days_elapsed.max(1), config.desired_retention)?,
            )
        } else {
            (
                steps.get(next).copied().unwrap_or(0) as f64,
                steps.get(next).copied().unwrap_or(0) as f64,
            )
        };
        return Ok([again, hard, good, easy]);
    }

    Ok([
        *config.learning_steps.first().unwrap_or(&0) as f64,
        compute_next(mem, 2, days_elapsed, config.desired_retention)?,
        compute_next(mem, 3, days_elapsed, config.desired_retention)?,
        compute_next(mem, 4, days_elapsed, config.desired_retention)?,
    ])
}

#[cfg(test)]
mod tests;
