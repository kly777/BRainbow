//! FSRS 间隔重复调度器（基于 fsrs crate v6.6）
//!
//! 状态机：new → learning → review ⇄ relearning
//! 学习步进：[1min, 10min]  重学步进：[10min]
//! Again 始终走 FSRS 降 stability

use crate::modules::mem::model::CardState;
use chrono::{DateTime, Duration, Utc};
use fsrs::{FSRS, MemoryState};

fn due_in_secs(secs: i64) -> String {
    (Utc::now() + Duration::seconds(secs))
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

/// 初始学习步进
const STEPS: [i64; 2] = [60, 600];
/// 遗忘后重学步进
const RELEARN_STEPS: [i64; 1] = [600];

fn make_fsrs() -> FSRS {
    FSRS::new(&[]).unwrap()
}

fn compute_next(mem: Option<MemoryState>, rating: u8) -> f64 {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, 0.9, 0).unwrap();
    let chosen = match rating {
        1 => &next.again,
        2 => &next.hard,
        3 => &next.good,
        _ => &next.easy,
    };
    (chosen.interval as f64 * 86400.0).max(60.0)
}

fn compute_next_with_state(mem: Option<MemoryState>, rating: u8) -> (f64, f64, f64) {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, 0.9, 0).unwrap();
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

pub struct ReviewOutcome {
    pub state: CardState,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
}

pub fn schedule(
    s_old: f64,
    d_old: f64,
    state: CardState,
    step_index: Option<usize>,
    rating: u8,
    _now: DateTime<Utc>,
) -> ReviewOutcome {
    use CardState::*;

    // ── 重学阶段 ──
    if state == Relearning {
        return relearn(s_old, d_old, step_index.unwrap_or(0), rating);
    }

    // ── 学习阶段 ──
    if state == Learning || state == New {
        let step = if state == New {
            0
        } else {
            step_index.unwrap_or(0)
        };
        return match rating {
            1 => {
                let mem = Some(MemoryState {
                    stability: s_old as f32,
                    difficulty: d_old as f32,
                });
                let (s, d, _) = compute_next_with_state(mem, 1);
                ReviewOutcome {
                    state: Learning,
                    stability: s,
                    difficulty: d,
                    due_at: due_in_secs(STEPS[0]),
                }
            }
            2 => {
                let secs = STEPS[step.min(STEPS.len() - 1)];
                ReviewOutcome {
                    state: Learning,
                    stability: s_old,
                    difficulty: d_old,
                    due_at: due_in_secs(secs),
                }
            }
            _ => {
                let next = step + 1;
                if next >= STEPS.len() {
                    let mem = Some(MemoryState {
                        stability: s_old as f32,
                        difficulty: d_old as f32,
                    });
                    let (s, d, secs) = compute_next_with_state(mem, rating);
                    ReviewOutcome {
                        state: Review,
                        stability: s,
                        difficulty: d,
                        due_at: due_in_secs(secs as i64),
                    }
                } else {
                    ReviewOutcome {
                        state: Learning,
                        stability: s_old,
                        difficulty: d_old,
                        due_at: due_in_secs(STEPS[next]),
                    }
                }
            }
        };
    }

    // ── 复习阶段 ──
    let mem = Some(MemoryState {
        stability: s_old as f32,
        difficulty: d_old as f32,
    });

    if rating == 1 {
        let (s, d, _) = compute_next_with_state(mem, 1);
        return ReviewOutcome {
            state: Relearning,
            stability: s,
            difficulty: d,
            due_at: due_in_secs(RELEARN_STEPS[0]),
        };
    }

    let (s, d, secs) = compute_next_with_state(mem, rating);
    ReviewOutcome {
        state: Review,
        stability: s,
        difficulty: d,
        due_at: due_in_secs(secs as i64),
    }
}

fn relearn(s_old: f64, d_old: f64, step: usize, rating: u8) -> ReviewOutcome {
    let mem = Some(MemoryState {
        stability: s_old as f32,
        difficulty: d_old as f32,
    });
    use CardState::*;

    match rating {
        1 => {
            let (s, d, _) = compute_next_with_state(mem, 1);
            ReviewOutcome {
                state: Relearning,
                stability: s,
                difficulty: d,
                due_at: due_in_secs(RELEARN_STEPS[0]),
            }
        }
        2 => {
            let secs = RELEARN_STEPS[step.min(RELEARN_STEPS.len() - 1)];
            ReviewOutcome {
                state: Relearning,
                stability: s_old,
                difficulty: d_old,
                due_at: due_in_secs(secs),
            }
        }
        _ => {
            let next = step + 1;
            if next >= RELEARN_STEPS.len() {
                let (s, d, secs) = compute_next_with_state(mem, rating);
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
                    due_at: due_in_secs(RELEARN_STEPS[next]),
                }
            }
        }
    }
}

pub fn preview(s_old: f64, d_old: f64, state: CardState, step_index: Option<usize>) -> [f64; 4] {
    let mem = Some(MemoryState {
        stability: s_old as f32,
        difficulty: d_old as f32,
    });
    use CardState::*;

    if state == Relearning {
        let step = step_index.unwrap_or(0);
        return [
            RELEARN_STEPS[0] as f64,
            RELEARN_STEPS[step.min(RELEARN_STEPS.len() - 1)] as f64,
            if step + 1 >= RELEARN_STEPS.len() {
                compute_next(mem, 3)
            } else {
                RELEARN_STEPS[step + 1] as f64
            },
            if step + 1 >= RELEARN_STEPS.len() {
                compute_next(mem, 4)
            } else {
                RELEARN_STEPS[step + 1] as f64
            },
        ];
    }

    if state == Learning || state == New {
        let step = if state == New {
            0
        } else {
            step_index.unwrap_or(0)
        };
        let again = STEPS[0] as f64;
        let hard = STEPS[step.min(STEPS.len() - 1)] as f64;
        let next = step + 1;
        let (good, easy) = if next >= STEPS.len() {
            (compute_next(mem, 3), compute_next(mem, 4))
        } else {
            (STEPS[next] as f64, STEPS[next] as f64)
        };
        return [again, hard, good, easy];
    }

    [
        STEPS[0] as f64,
        compute_next(mem, 2),
        compute_next(mem, 3),
        compute_next(mem, 4),
    ]
}
