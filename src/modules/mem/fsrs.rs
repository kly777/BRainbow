//! 简化版 FSRS (Free Spaced Repetition Scheduler)
//!
//! 参考: https://github.com/open-spaced-repetition/fsrs-rs
//!
//! 核心概念:
//!   state: new → learning → review → relearning
//!   stability(S): 记忆稳固度，越大间隔越长
//!   difficulty(D): 0~1，越接近 1 越难
//!
//! 评分: 1=Again 2=Hard 3=Good 4=Easy

use chrono::{DateTime, Duration, Utc};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CardState {
    New,
    Learning,
    Review,
    Relearning,
}

impl CardState {
    pub fn as_str(&self) -> &str {
        match self {
            CardState::New => "new",
            CardState::Learning => "learning",
            CardState::Review => "review",
            CardState::Relearning => "relearning",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "learning" => CardState::Learning,
            "review" => CardState::Review,
            "relearning" => CardState::Relearning,
            _ => CardState::New,
        }
    }
}

/// FSRS 参数（使用默认值）
const W: [f64; 19] = [
    1.0, 1.0, 5.0,
    0.9, 0.9, 1.0, 1.2, 2.0,
    0.2, 0.6, 2.0, 0.4, 2.5,
    0.5, 0.4, 0.4, 1.0, 2.0, 0.1,
];

#[derive(Debug, Clone)]
pub struct ReviewResult {
    pub state: CardState,
    pub stability: f64,
    pub difficulty: f64,
    pub due_at: DateTime<Utc>,
}

/// 根据评分计算下一次复习时间
pub fn schedule(
    state: CardState,
    stability: f64,
    difficulty: f64,
    rating: u8, // 1=Again 2=Hard 3=Good 4=Easy
    now: DateTime<Utc>,
) -> ReviewResult {
    let r = rating as f64;

    match state {
        CardState::New | CardState::Learning => {
            // 首次/学习中：直接根据评分决定
            let new_d = initial_difficulty(r);
            let new_s = initial_stability(r);
            let interval = next_interval(new_s);
            let new_state = if (r - 1.0).abs() < f64::EPSILON { CardState::Relearning } else { CardState::Review };

            ReviewResult {
                state: new_state,
                stability: new_s,
                difficulty: new_d,
                due_at: now + Duration::seconds((interval * 86400.0) as i64),
            }
        }
        CardState::Review | CardState::Relearning => {
            let retrievability = forgetting_curve(0.0, stability); // 刚复习完，elapsed=0
            let new_d = next_difficulty(difficulty, r);
            let new_s = next_stability(stability, retrievability, new_d, r);

            let new_state = if (r - 1.0).abs() < f64::EPSILON {
                CardState::Relearning
            } else {
                CardState::Review
            };

            let interval = next_interval(new_s);

            ReviewResult {
                state: new_state,
                stability: new_s,
                difficulty: new_d,
                due_at: now + Duration::seconds((interval * 86400.0) as i64),
            }
        }
    }
}

fn initial_difficulty(r: f64) -> f64 {
    let d = W[4] - W[5] * (r - 3.0);
    d.clamp(0.0, 1.0)
}

fn initial_stability(r: f64) -> f64 {
    let s = W[0] + W[1] * (r - 1.0).max(0.0);
    s.max(0.1)
}

fn next_difficulty(d: f64, r: f64) -> f64 {
    let delta = -W[6] * (r - 3.0);
    let new_d = d + delta * (1.0 - d);
    new_d.clamp(0.0, 1.0)
}

fn next_stability(s: f64, retrievability: f64, d: f64, r: f64) -> f64 {
    if r == 1.0 {
        // Again
        let s_min = W[7];
        s * W[8] + s_min * (1.0 - W[8])
    } else {
        let factor = 1.0 + W[9] * (r - 2.0).max(0.0) * (1.0 - d);
        s * factor
    }
}

fn next_interval(s: f64) -> f64 {
    // 间隔 = stability × ln(desired_retention) / ln(0.9)
    (s * 9.0).max(0.016) // 最少约 23 分钟
}

fn forgetting_curve(elapsed_days: f64, s: f64) -> f64 {
    (1.0 + 19.0 * (elapsed_days / s)).powf(-0.5)
}
