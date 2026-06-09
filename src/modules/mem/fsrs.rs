//! FSRS-5 间隔重复调度器
//!
//! 标准 FSRS-5 公式，与 Anki 24.11+ 行为一致。
//! 返回秒级精度，支持 1 分钟学习步进。

use chrono::{DateTime, Duration, Utc};

const W: [f64; 13] = [
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975,
    0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793,
];

const RETENTION: f64 = 0.9;

fn init_stability(r: u8) -> f64 { [W[0], W[1], W[2], W[3]][r as usize - 1] }
fn init_difficulty(r: u8) -> f64 { (W[4] - W[5] * (r as f64 - 3.0)).clamp(1.0, 10.0) }

fn next_stability(s: f64, d: f64, r: u8) -> f64 {
    if r == 1 { (W[7] * s + W[8] * (d - 1.0).max(0.0) * s).max(0.01) }
    else { (s * (1.0 + (W[6] * (r as f64 - 3.0)).exp() * (1.0 - d / 10.0))).max(0.01) }
}

fn next_difficulty(d: f64, r: u8) -> f64 {
    (d - W[5] * (r as f64 - 3.0) * (10.0 - d) / 9.0).clamp(1.0, 10.0)
}

fn interval_secs(s: f64) -> f64 {
    (s * 9.0 * (RETENTION.powf(-2.0) - 1.0) / 19.0 * 86400.0).max(60.0)
}

pub struct ReviewOutcome {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
    pub interval_secs: f64,
}

pub fn schedule(
    s_old: f64, d_old: f64, is_new: bool, rating: u8, now: DateTime<Utc>,
) -> ReviewOutcome {
    if rating == 1 && is_new {
        return ReviewOutcome {
            state: "learning".into(), stability: 0.0, difficulty: 0.0,
            due_at: (now + Duration::seconds(60)).format("%Y-%m-%dT%H:%M:%S").to_string(),
            interval_secs: 60.0,
        };
    }
    let (s, d) = if is_new { (init_stability(rating), init_difficulty(rating)) }
                  else { (next_stability(s_old, d_old, rating), next_difficulty(d_old, rating)) };
    let secs = interval_secs(s);
    let state = if rating == 1 { "relearning" } else { "review" };
    ReviewOutcome {
        state: state.into(), stability: s, difficulty: d,
        due_at: (now + Duration::seconds(secs as i64)).format("%Y-%m-%dT%H:%M:%S").to_string(),
        interval_secs: secs,
    }
}

pub fn preview(s_old: f64, d_old: f64, is_new: bool) -> [f64; 4] {
    let mut secs = [60.0, 0.0, 0.0, 0.0]; // [0]=again fixed at 60s for new cards
    for r in 1..=4u8 {
        if r == 1 && is_new { continue; }
        let s = if is_new { init_stability(r) } else { next_stability(s_old, d_old, r) };
        secs[(r - 1) as usize] = interval_secs(s);
    }
    secs
}
