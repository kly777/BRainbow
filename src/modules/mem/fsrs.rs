//! FSRS 间隔重复调度器（基于 fsrs crate v6.6）
//!
//! 新卡 → 学习 [1min, 10min] → 毕业 → FSRS review
//! Again 永远是短步进 (1min)

use chrono::{DateTime, Utc};
use fsrs::{FSRS, MemoryState};
use crate::time;

const STEPS: [i64; 2] = [60, 600];

fn make_fsrs() -> FSRS { FSRS::new(&[]).unwrap() }

fn compute_next(mem: Option<MemoryState>, rating: u8) -> f64 {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, 0.9, 0).unwrap();
    let chosen = match rating { 1 => &next.again, 2 => &next.hard, 3 => &next.good, _ => &next.easy };
    (chosen.interval as f64 * 86400.0).max(60.0)
}

fn compute_next_with_state(mem: Option<MemoryState>, rating: u8) -> (f64, f64, f64) {
    let fsrs = make_fsrs();
    let next = fsrs.next_states(mem, 0.9, 0).unwrap();
    let chosen = match rating { 1 => &next.again, 2 => &next.hard, 3 => &next.good, _ => &next.easy };
    let secs = (chosen.interval as f64 * 86400.0).max(60.0);
    (chosen.memory.stability as f64, chosen.memory.difficulty as f64, secs)
}

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

    if let Some(step) = step {
        return match rating {
            1 => ReviewOutcome {
                state: "learning".into(), stability: s_old, difficulty: d_old,
                due_at: time::due_in_secs(STEPS[0]),
            },
            2 => {
                let secs = STEPS[step.min(STEPS.len() - 1)];
                ReviewOutcome { state: "learning".into(), stability: s_old, difficulty: d_old, due_at: time::due_in_secs(secs) }
            }
            _ => {
                let next = step + 1;
                if next >= STEPS.len() {
                    let (s, d, secs) = compute_next_with_state(None, rating);
                    ReviewOutcome { state: "review".into(), stability: s, difficulty: d, due_at: time::due_in_secs(secs as i64) }
                } else {
                    ReviewOutcome { state: "learning".into(), stability: s_old, difficulty: d_old, due_at: time::due_in_secs(STEPS[next]) }
                }
            }
        };
    }

    if rating == 1 {
        return ReviewOutcome {
            state: "review".into(), stability: s_old, difficulty: d_old,
            due_at: time::due_in_secs(STEPS[0]),
        };
    }

    let mem = Some(MemoryState { stability: s_old as f32, difficulty: d_old as f32 });
    let (s, d, secs) = compute_next_with_state(mem, rating);
    ReviewOutcome { state: "review".into(), stability: s, difficulty: d, due_at: time::due_in_secs(secs as i64) }
}

pub fn preview(s_old: f64, d_old: f64, state: &str, step_index: Option<usize>) -> [f64; 4] {
    let step = if state == "new" { Some(0) } else { step_index };
    if let Some(step) = step {
        let again = STEPS[0] as f64;
        let hard = STEPS[step.min(STEPS.len() - 1)] as f64;
        let next = step + 1;
        let (good, easy) = if next >= STEPS.len() {
            (compute_next(None, 3), compute_next(None, 4))
        } else {
            (STEPS[next] as f64, STEPS[next] as f64)
        };
        return [again, hard, good, easy];
    }
    let mem = Some(MemoryState { stability: s_old as f32, difficulty: d_old as f32 });
    [STEPS[0] as f64, compute_next(mem, 2), compute_next(mem, 3), compute_next(mem, 4)]
}
