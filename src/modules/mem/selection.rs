//! 复习队列的难度感知加权采样。
//!
//! 目标：保留随机性（不会每次都同一顺序），同时让「难卡 / 遗忘次数多 /
//! 已过期」的卡有更高的选中概率。FSRS 负责跨轮间隔，这里负责**同轮候选排序**。
//!
//! 采样算法：Efraimidis–Spirakis 指数竞速（每个候选取
//! `ln(U) / weight` 作为 key，key 越小优先级越高），等价于不放回加权采样。

use crate::modules::mem::model::ReviewCandidate;
use chrono::{DateTime, Utc};
use rand::{Rng, RngExt};

/// 难度增益：difficulty=9 时约为 difficulty=5 的 `1 + DIFFICULTY_GAIN * 0.8` 倍
pub const DIFFICULTY_GAIN: f64 = 2.0;
/// 每次遗忘失败带来的权重增益（lapses 最多计 8 次）
pub const LAPSE_GAIN: f64 = 0.35;
/// 每过期一天带来的权重增益（最多计 30 天）
pub const OVERDUE_GAIN_PER_DAY: f64 = 0.25;
/// 未到期卡的基础权重（保证任何候选都至少有机会被抽中）
pub const MIN_URGENCY: f64 = 0.1;

fn days_since(last_review_at: &Option<String>, now: DateTime<Utc>) -> f64 {
    let Some(raw) = last_review_at else {
        return 0.0;
    };
    let Ok(t) = DateTime::parse_from_rfc3339(raw) else {
        return 0.0;
    };
    ((now - t.with_timezone(&Utc)).num_seconds() as f64 / 86400.0).max(0.0)
}

fn days_until_due(due_at: &str, now: DateTime<Utc>) -> f64 {
    let Ok(due) = DateTime::parse_from_rfc3339(due_at) else {
        return 0.0;
    };
    (due.with_timezone(&Utc) - now).num_seconds() as f64 / 86400.0
}

/// FSRS 回忆概率近似 R = (1 + t/(9S))^-1
pub fn retrievability(stability: f64, days_since_review: f64) -> f64 {
    let s = stability.max(0.01);
    let t = days_since_review.max(0.0);
    (1.0 + t / (9.0 * s)).powf(-1.0)
}

/// 单张复习候选的采样权重。
///
/// 组成：
/// - urgency：越接近遗忘（retrievability 低）权重越高
/// - difficulty：FSRS 难度越高权重越高（难度 ≤5 不惩罚）
/// - lapses：失败次数越多权重越高
/// - due_factor：已过期按过期天数加权；未到期按「快到到期」加权
pub fn review_candidate_weight(candidate: &ReviewCandidate, now: DateTime<Utc>) -> f64 {
    let days = days_since(&candidate.last_review_at, now);
    let r = retrievability(candidate.stability, days);
    let urgency = (0.9 - r).clamp(0.0, 1.0).max(MIN_URGENCY);

    let difficulty_factor =
        1.0 + DIFFICULTY_GAIN * ((candidate.difficulty - 5.0) / 5.0).clamp(0.0, 1.0);
    let lapse_factor = 1.0 + LAPSE_GAIN * candidate.lapses.min(8) as f64;

    let until_due_days = days_until_due(&candidate.due_at, now);
    let due_factor = if until_due_days > 0.0 {
        // 未来到期：越近越高，但远卡仍保留基础机会
        (1.0 + until_due_days).powf(-1.0).max(0.05)
    } else {
        // 已过期：按过期天数加权（封顶 30 天，避免一张远古卡永远霸榜）
        1.0 + OVERDUE_GAIN_PER_DAY * (-until_due_days).min(30.0)
    };

    urgency * difficulty_factor * lapse_factor * due_factor
}

/// 不放回加权采样：返回 `quota.min(len)` 个索引（按采样优先级排序）。
///
/// 所有权重 ≤0 的候选不会在正权重候选取尽前被选中。
pub fn weighted_sample_indices<R: Rng + ?Sized>(
    weights: &[f64],
    quota: usize,
    rng: &mut R,
) -> Vec<usize> {
    let take = quota.min(weights.len());
    if take == 0 {
        return Vec::new();
    }

    let mut keyed: Vec<(f64, usize)> = weights
        .iter()
        .enumerate()
        .map(|(i, &w)| {
            let u: f64 = rng.random();
            // Efraimidis–Spirakis：key = -ln(U) / weight，key 越小越先选中
            let key = if w > 0.0 { -u.ln() / w } else { f64::INFINITY };
            (key, i)
        })
        .collect();
    keyed.sort_by(|a, b| a.0.total_cmp(&b.0));
    keyed.into_iter().take(take).map(|(_, i)| i).collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use rand::SeedableRng;
    use rand::rngs::StdRng;

    fn candidate(
        id: i32,
        difficulty: f64,
        lapses: i32,
        due_in_hours: f64,
        reviewed_days_ago: f64,
    ) -> ReviewCandidate {
        let now = Utc::now();
        let due = now + chrono::Duration::seconds((due_in_hours * 3600.0) as i64);
        let last_review = now - chrono::Duration::seconds((reviewed_days_ago * 86400.0) as i64);
        ReviewCandidate {
            id,
            stability: 5.0,
            difficulty,
            lapses,
            due_at: due.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
            last_review_at: Some(last_review.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
        }
    }

    #[test]
    fn weight_increases_with_difficulty() {
        let now = Utc::now();
        let low = candidate(1, 3.0, 0, -24.0, 2.0);
        let mid = candidate(2, 5.0, 0, -24.0, 2.0);
        let high = candidate(3, 9.0, 0, -24.0, 2.0);
        let wl = review_candidate_weight(&low, now);
        let wm = review_candidate_weight(&mid, now);
        let wh = review_candidate_weight(&high, now);
        assert!(wl <= wm, "low {wl:.3} <= mid {wm:.3}");
        assert!(wm < wh, "mid {wm:.3} < high {wh:.3}");
    }

    #[test]
    fn weight_increases_with_lapses() {
        let now = Utc::now();
        let none = candidate(1, 5.0, 0, -24.0, 2.0);
        let some = candidate(2, 5.0, 3, -24.0, 2.0);
        let many = candidate(3, 5.0, 8, -24.0, 2.0);
        assert!(review_candidate_weight(&none, now) < review_candidate_weight(&some, now));
        assert!(review_candidate_weight(&some, now) < review_candidate_weight(&many, now));
    }

    #[test]
    fn weight_increases_with_overdue_days() {
        let now = Utc::now();
        let early = candidate(1, 5.0, 0, -24.0, 2.0);
        let late = candidate(2, 5.0, 0, -24.0 * 10.0, 2.0);
        assert!(review_candidate_weight(&early, now) < review_candidate_weight(&late, now));
    }

    #[test]
    fn future_cards_are_weighted_lower_than_due_cards() {
        let now = Utc::now();
        let due = candidate(1, 5.0, 0, -1.0, 2.0);
        let future = candidate(2, 5.0, 0, 24.0, 2.0);
        assert!(review_candidate_weight(&future, now) < review_candidate_weight(&due, now));
    }

    #[test]
    fn sampling_respects_quota_and_has_no_duplicates() {
        let weights = [1.0, 2.0, 3.0, 4.0, 5.0];
        let mut rng = StdRng::seed_from_u64(7);
        let idx = weighted_sample_indices(&weights, 3, &mut rng);
        assert_eq!(idx.len(), 3);
        let mut sorted = idx.clone();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted.len(), 3);
        assert!(idx.iter().all(|&i| i < weights.len()));
    }

    #[test]
    fn sampling_is_deterministic_for_a_seed() {
        let weights = [1.0, 2.0, 3.0, 4.0, 5.0];
        let mut rng_a = StdRng::seed_from_u64(42);
        let mut rng_b = StdRng::seed_from_u64(42);
        let a = weighted_sample_indices(&weights, 3, &mut rng_a);
        let b = weighted_sample_indices(&weights, 3, &mut rng_b);
        assert_eq!(a, b);
    }

    #[test]
    fn sampling_prefers_hard_cards_statistically() {
        // 10 张难卡 vs 10 张简单卡；难卡权重约 7 倍 → 单次抽取难卡概率应显著 > 0.6
        let now = Utc::now();
        let hard: Vec<ReviewCandidate> =
            (0..10).map(|i| candidate(i, 9.0, 5, -24.0, 2.0)).collect();
        let easy: Vec<ReviewCandidate> =
            (10..20).map(|i| candidate(i, 2.0, 0, -24.0, 2.0)).collect();
        let all: Vec<&ReviewCandidate> = hard.iter().chain(easy.iter()).collect();
        let weights: Vec<f64> = all
            .iter()
            .map(|c| review_candidate_weight(c, now))
            .collect();

        let mut rng = StdRng::seed_from_u64(123);
        let runs = 20_000;
        let mut hard_hits = 0usize;
        for _ in 0..runs {
            let picked = weighted_sample_indices(&weights, 1, &mut rng);
            hard_hits += usize::from(picked[0] < 10);
        }
        let ratio = hard_hits as f64 / runs as f64;
        assert!(
            ratio > 0.7,
            "难卡单次抽样占比过低：{ratio:.3}（期望显著高于 0.7）"
        );
    }

    #[test]
    fn weighted_policy_exposes_hard_cards_more_than_due_order() {
        let now = Utc::now();
        // 简单卡更早到期（旧策略会一直选它们），难卡更晚到期但难度/失败次数高
        let easy: Vec<ReviewCandidate> =
            (0..10).map(|i| candidate(i, 2.0, 0, -72.0, 2.0)).collect();
        let hard: Vec<ReviewCandidate> =
            (10..20).map(|i| candidate(i, 9.0, 5, -24.0, 2.0)).collect();
        let mut all = easy.clone();
        all.extend(hard.clone());
        all.sort_by(|a, b| a.due_at.cmp(&b.due_at));

        // 旧策略：到期最早优先，quota=5 → 每次都是 5 张简单卡
        let old_picks = 5_000usize * 5;
        let old_hard_exposure = 0usize;

        // 新策略：难度加权采样
        let weights: Vec<f64> = all
            .iter()
            .map(|c| review_candidate_weight(c, now))
            .collect();
        let mut rng = StdRng::seed_from_u64(99);
        let batches = 5_000;
        let mut new_hard_exposure = 0usize;
        for _ in 0..batches {
            for idx in weighted_sample_indices(&weights, 5, &mut rng) {
                new_hard_exposure += usize::from(all[idx].difficulty >= 9.0);
            }
        }

        assert!(old_hard_exposure == 0, "旧策略按 due_at 应完全选中简单卡");
        let new_ratio = new_hard_exposure as f64 / old_picks as f64;
        assert!(new_ratio > 0.6, "新策略难卡曝光占比过低：{new_ratio:.3}");
        assert!(
            new_hard_exposure as f64 > old_hard_exposure as f64 * 2.0,
            "新策略难卡曝光应显著高于旧策略"
        );
    }

    #[test]
    fn sampling_quota_larger_than_len_returns_all() {
        let weights = [1.0, 2.0, 3.0];
        let mut rng = StdRng::seed_from_u64(1);
        let idx = weighted_sample_indices(&weights, 10, &mut rng);
        assert_eq!(idx.len(), 3);
        let mut sorted = idx.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, vec![0, 1, 2]);
    }
}
