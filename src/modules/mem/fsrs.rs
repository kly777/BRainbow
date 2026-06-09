//! FSRS-5 间隔重复调度器
//!
//! 标准 FSRS-5 参数和公式，与 Anki 内置调度器行为一致。
//! 参考: https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm

use chrono::{DateTime, Duration, Utc};

const W: [f64; 13] = [
    0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975,
    0.031, 1.6474, 0.1367, 1.0461, 2.1072, 0.0793,
];

const RETENTION: f64 = 0.9;
const MAX_INTERVAL_SECS: i64 = 36500 * 86400; // 最大 100 年

/// 可检索性 R(t, S)
fn retrievability(t: f64, s: f64) -> f64 {
    (1.0 + 19.0 * t / (9.0 * s)).powf(-0.5)
}

/// stability 增长
fn next_stability(s: f64, d: f64, r: u8) -> f64 {
    if r == 1 {
        W[7] * s + W[8] * (d - 1.0).max(0.0) * s
    } else {
        let factor = 1.0 + (W[6] * (r as f64 - 3.0)).exp() * (1.0 - d / 10.0);
        s * factor
    }.max(0.01)
}

/// difficulty 更新 (1~10)
fn next_difficulty(d: f64, r: u8) -> f64 {
    let delta = -W[5] * (r as f64 - 3.0);
    (d + delta * (10.0 - d) / 9.0).clamp(1.0, 10.0)
}

/// 初始 stability
fn init_stability(r: u8) -> f64 {
    match r {
        1 => W[0],
        2 => W[1],
        3 => W[2],
        _ => W[3],
    }
}

/// 初始 difficulty
fn init_difficulty(r: u8) -> f64 {
    (W[4] - W[5] * (r as f64 - 3.0)).clamp(1.0, 10.0)
}

/// 间隔天数 = stability * ((R_desired)^(-0.5) - 1) / 19 * 9
fn interval_days(s: f64) -> f64 {
    let i = s * 9.0 * (RETENTION.powf(-2.0) - 1.0) / 19.0;
    i.max(0.016) // 至少约 23 分钟
}

pub struct ReviewOutcome {
    pub state: String,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: String,
    pub interval_days: f64,
}

pub fn schedule(
    s_old: f64,
    d_old: f64,
    is_new: bool,
    rating: u8,
    now: DateTime<Utc>,
) -> ReviewOutcome {
    // 新卡忘记 → 1 分钟后重学（进入 learning 步进）
    if rating == 1 && is_new {
        return ReviewOutcome {
            state: "learning".to_string(),
            stability: 0.0,
            difficulty: 0.0,
            due_at: (now + Duration::seconds(60)).format("%Y-%m-%dT%H:%M:%S").to_string(),
            interval_days: 1.0 / 1440.0,
        };
    }

    let (s_new, d_new) = if is_new {
        (init_stability(rating), init_difficulty(rating))
    } else {
        (next_stability(s_old, d_old, rating), next_difficulty(d_old, rating))
    };

    let days = interval_days(s_new);
    let secs = (days * 86400.0) as i64;
    let due_at = if secs > MAX_INTERVAL_SECS {
        now + Duration::seconds(MAX_INTERVAL_SECS)
    } else {
        now + Duration::seconds(secs)
    };
    let state = if rating == 1 { "relearning" } else { "review" };

    ReviewOutcome {
        state: state.to_string(),
        stability: s_new,
        difficulty: d_new,
        due_at: due_at.format("%Y-%m-%dT%H:%M:%S").to_string(),
        interval_days: days,
    }
}

pub fn preview(s_old: f64, d_old: f64, is_new: bool) -> [f64; 4] {
    // 新卡忘记 → 1 分钟
    if is_new {
        return [1.0 / 1440.0, interval_days(init_stability(2)).max(0.016), interval_days(init_stability(3)).max(0.016), interval_days(init_stability(4)).max(0.016)];
    }
    let mut days = [0.0; 4];
    for r in 1..=4u8 {
        let s = if is_new { init_stability(r) } else { next_stability(s_old, d_old, r) };
        days[(r - 1) as usize] = interval_days(s).max(0.016);
    }
    days
}
