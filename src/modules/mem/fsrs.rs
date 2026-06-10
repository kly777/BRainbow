//! FSRS 间隔重复调度器（基于 fsrs crate v6.6）
//!
//! 新卡 → 学习 [1min, 10min] → 毕业 → FSRS review
//! Again 永远是短步进 (1min)

use chrono::{DateTime, Duration, Utc};
use fsrs::{FSRS, MemoryState};
use crate::time;

const STEPS: [i64; 2] = [60, 600];

pub struct ReviewOutcome {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
}

pub fn schedule(
    s_old: f64, d_old: f64, state: &str, step_index: Option<usize>,
    rating: u8, _now: DateTime<Utc>,
) -> ReviewOutcome {
    let step = if state == "new" { Some(0) } else { step_index };

    // 学习阶段
    if let Some(step) = step {
        return match rating {
            1 => ReviewOutcome {
                state: "learning".into(), stability: s_old, difficulty: d_old,
                due_at: time::due_in_secs(STEPS[0]),
            },
            2 => {
                let secs = STEPS[step.min(STEPS.len() - 1)];
                ReviewOutcome {
                    state: "learning".into(), stability: s_old, difficulty: d_old,
                    due_at: time::due_in_secs(secs),
                }
            }
            _ => {
                let next = step + 1;
                if next >= STEPS.len() {
                    fsrs_review(None, rating)
                } else {
                    ReviewOutcome {
                        state: "learning".into(), stability: s_old, difficulty: d_old,
                        due_at: time::due_in_secs(STEPS[next]),
                    }
                }
            }
        };
    }

    // Again → 短步进，但更新 S/D（FSRS again 状态）
    if rating == 1 {
        let mem = MemoryState { stability: s_old as f32, difficulty: d_old as f32 };
        let fsrs = FSRS::default();
        if let Ok(next) = fsrs.next_states(Some(mem), 0.9, 0) {
            return ReviewOutcome {
                state: "review".into(),
                stability: next.again.memory.stability as f64,
                difficulty: next.again.memory.difficulty as f64,
                due_at: time::due_in_secs(STEPS[0]),
            };
        }
        return ReviewOutcome {
            state: "review".into(), stability: s_old, difficulty: d_old,
            due_at: time::due_in_secs(STEPS[0]),
        };
    }

    let mem = MemoryState { stability: s_old as f32, difficulty: d_old as f32 };
    fsrs_review(Some(mem), rating)
}

fn fsrs_review(mem: Option<MemoryState>, rating: u8) -> ReviewOutcome {
    let fsrs = FSRS::default();
    let next = fsrs.next_states(mem, 0.9, 0).unwrap_or_else(|_| panic!("FSRS error"));
    let chosen = match rating { 1 => &next.again, 2 => &next.hard, 3 => &next.good, _ => &next.easy };
    let s = chosen.memory.stability as f64;
    let d = chosen.memory.difficulty as f64;
    let secs = (chosen.interval as f64 * 86400.0).max(60.0);
    ReviewOutcome {
        state: "review".into(), stability: s, difficulty: d,
        due_at: time::due_in_secs(secs as i64),
    }
}

pub fn preview(s_old: f64, d_old: f64, state: &str, step_index: Option<usize>) -> [f64; 4] {
    let step = if state == "new" { Some(0) } else { step_index };
    if let Some(step) = step {
        let again = STEPS[0] as f64;
        let hard = STEPS[step.min(STEPS.len() - 1)] as f64;
        let next = step + 1;
        let (good, easy) = if next >= STEPS.len() {
            let mem = MemoryState { stability: s_old as f32, difficulty: d_old as f32 };
            let fsrs = FSRS::default();
            if let Ok(next) = fsrs.next_states(Some(mem), 0.9, 0) {
                ((next.good.interval as f64 * 86400.0).max(60.0),
                 (next.easy.interval as f64 * 86400.0).max(60.0))
            } else { (STEPS[next] as f64, STEPS[next] as f64) }
        } else {
            (STEPS[next] as f64, STEPS[next] as f64)
        };
        return [again, hard, good, easy];
    }
    // review
    let again = STEPS[0] as f64;
    let mem = MemoryState { stability: s_old as f32, difficulty: d_old as f32 };
    let fsrs = FSRS::default();
    if let Ok(next) = fsrs.next_states(Some(mem), 0.9, 0) {
        [
            again,
            (next.hard.interval as f64 * 86400.0).max(60.0),
            (next.good.interval as f64 * 86400.0).max(60.0),
            (next.easy.interval as f64 * 86400.0).max(60.0),
        ]
    } else {
        [again, 3600.0, 86400.0, 259200.0]
    }
}
