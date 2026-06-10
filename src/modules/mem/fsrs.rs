//! FSRS-5 + Anki 式学习步进 + Fuzz
//!
//! 新卡 → 学习 [1min, 10min] → 毕业 → FSRS review
//! 复习/重新学习 → FSRS-5
//! 间隔 ±5% 随机抖动

use chrono::{DateTime, Utc};

use crate::time;

const W: [f64; 13] = [
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975,
    0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793,
];
const RETENTION: f64 = 0.9;
const STEPS: [i64; 2] = [60, 600];

fn init_s(r: u8) -> f64 { [W[0], W[1], W[2], W[3]][r as usize - 1] }
fn init_d(r: u8) -> f64 { (W[4] - W[5] * (r as f64 - 3.0)).clamp(1.0, 10.0) }
fn next_s(s: f64, d: f64, r: u8) -> f64 {
    if r == 1 { (s * 0.5).max(W[7]) }
    else { s * (1.0 + (W[6] * (r as f64 - 3.0)).exp() * (1.0 - d / 10.0)).max(0.01) }
}
fn next_d(d: f64, r: u8) -> f64 { (d - W[5] * (r as f64 - 3.0) * (10.0 - d) / 9.0).clamp(1.0, 10.0) }
fn intv(s: f64) -> f64 { (s * 9.0 * (RETENTION.powf(-2.0) - 1.0) / 19.0 * 86400.0).max(60.0) }

fn fuzz(secs: f64) -> f64 {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos();
    let r = (nanos as f64 % 100.0) / 100.0;
    (secs * (0.95 + r * 0.1)).max(60.0)
}

pub struct ReviewOutcome {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
    pub interval_secs: f64,
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
                due_at: time::due_in_secs(STEPS[0]), interval_secs: STEPS[0] as f64,
            },
            2 => {
                let secs = STEPS[step.min(STEPS.len() - 1)];
                ReviewOutcome {
                    state: "learning".into(), stability: s_old, difficulty: d_old,
                    due_at: time::due_in_secs(secs), interval_secs: secs as f64,
                }
            }
            _ => {
                let next = step + 1;
                if next >= STEPS.len() {
                    let s = init_s(rating); let d = init_d(rating); let secs = fuzz(intv(s));
                    ReviewOutcome {
                        state: "review".into(), stability: s, difficulty: d,
                        due_at: time::due_in_secs(secs as i64), interval_secs: secs,
                    }
                } else {
                    ReviewOutcome {
                        state: "learning".into(), stability: s_old, difficulty: d_old,
                        due_at: time::due_in_secs(STEPS[next]), interval_secs: STEPS[next] as f64,
                    }
                }
            }
        };
    }

    // Again on review → 回到短步进
    if rating == 1 {
        return ReviewOutcome {
            state: "review".into(), stability: s_old, difficulty: d_old,
            due_at: time::due_in_secs(STEPS[0]), interval_secs: STEPS[0] as f64,
        };
    }

    let (s, d) = (next_s(s_old, d_old, rating), next_d(d_old, rating));
    let secs = fuzz(intv(s));
    ReviewOutcome {
        state: "review".into(), stability: s, difficulty: d,
        due_at: time::due_in_secs(secs as i64), interval_secs: secs,
    }
}

pub fn preview(s_old: f64, d_old: f64, state: &str, step_index: Option<usize>) -> [f64; 4] {
    let step = if state == "new" { Some(0) } else { step_index };
    if let Some(step) = step {
        let again = STEPS[0] as f64;
        let hard = STEPS[step.min(STEPS.len() - 1)] as f64;
        let next = step + 1;
        let (good, easy) = if next >= STEPS.len() {
            (fuzz(intv(init_s(3))), fuzz(intv(init_s(4))))
        } else {
            (STEPS[next] as f64, STEPS[next] as f64)
        };
        return [again, hard, good, easy];
    }
    // review: again → 1分钟短步进
    let again = STEPS[0] as f64;
    let hard = fuzz(intv(next_s(s_old, d_old, 2)));
    let good = fuzz(intv(next_s(s_old, d_old, 3)));
    let easy = fuzz(intv(next_s(s_old, d_old, 4)));
    [again, hard, good, easy]
}
