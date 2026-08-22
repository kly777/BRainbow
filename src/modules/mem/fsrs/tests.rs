#![allow(clippy::unwrap_used)]

use super::*;

/// 全局 FSRS 参数被多个测试共享（并行时互相污染），
/// 所有读写全局参数的测试经此锁串行化。
static FSRS_PARAMS_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// 测试内获取全局参数锁（防止并行测试污染 GLOBAL_FSRS_PARAMS）
fn lock_params() -> std::sync::MutexGuard<'static, ()> {
    FSRS_PARAMS_LOCK.lock().unwrap()
}
use chrono::Utc;
use rand::Rng;
use rand::RngExt;
use rand::SeedableRng;

/// 默认测试配置
fn test_config() -> SchedulerConfig {
    SchedulerConfig::default()
}

fn schedule_secs(
    s_old: f64,
    d_old: f64,
    state: CardState,
    step_index: Option<usize>,
    rating: u8,
    days_elapsed: u32,
) -> f64 {
    let now = Utc::now();
    let config = test_config();
    let outcome = schedule(
        ScheduleInput {
            s_old,
            d_old,
            state,
            step_index,
            rating,
            days_elapsed,
            cumulative_step_days: 0,
        },
        &config,
    )
    .unwrap();
    let due = chrono::DateTime::parse_from_rfc3339(&outcome.due_at)
        .unwrap()
        .with_timezone(&Utc);
    (due - now).num_seconds() as f64
}

fn rating_name(r: u8) -> &'static str {
    match r {
        1 => "Again",
        2 => "Hard",
        3 => "Good",
        _ => "Easy",
    }
}

fn interval_days(stability: f64) -> f64 {
    stability
}

// ── 1. 间隔排序 ──

#[test]
fn intervals_are_ordered_for_new_card() {
    let _g = lock_params();
    let intervals: Vec<f64> = (1..=4)
        .map(|r| schedule_secs(0.0, 0.0, CardState::New, None, r, 0))
        .collect();
    assert!(intervals[0] <= intervals[1]);
    assert!(intervals[1] <= intervals[2]);
    assert!(intervals[2] <= intervals[3]);
}

#[test]
fn intervals_are_ordered_for_review_card() {
    let _g = lock_params();
    let intervals: Vec<f64> = (1..=4)
        .map(|r| schedule_secs(5.0, 5.0, CardState::Review, None, r, 3))
        .collect();
    for i in 0..3 {
        assert!(
            intervals[i] < intervals[i + 1],
            "{} ({:.0}s) < {} ({:.0}s)",
            rating_name(i as u8 + 1),
            intervals[i],
            rating_name(i as u8 + 2),
            intervals[i + 1]
        );
    }
}

#[test]
fn intervals_are_ordered_for_learning_card() {
    let _g = lock_params();
    let intervals: Vec<f64> = (1..=4)
        .map(|r| schedule_secs(0.0, 0.0, CardState::Learning, Some(0), r, 0))
        .collect();
    assert!(intervals[1] <= intervals[2]);
}

// ── 2. days_elapsed ──

#[test]
fn larger_days_elapsed_gives_larger_intervals() {
    let _g = lock_params();
    for rating in [2u8, 3, 4] {
        let iv0 = schedule_secs(2.0, 5.0, CardState::Review, None, rating, 0);
        let iv1 = schedule_secs(2.0, 5.0, CardState::Review, None, rating, 1);
        let iv7 = schedule_secs(2.0, 5.0, CardState::Review, None, rating, 7);
        assert!(iv0 < iv1);
        assert!(iv1 < iv7);
    }
}

// ── 3. 难度对比 ──

#[test]
fn good_grows_faster_than_hard() {
    let _g = lock_params();
    let config = test_config();
    let mut results = Vec::new();
    for &rating in &[2u8, 3, 4] {
        let mut s = 2.0;
        let mut d = 5.0;
        // 5 次 Review（用相同初始 S/D）
        for _ in 0..5 {
            let o = schedule(
                ScheduleInput {
                    s_old: s,
                    d_old: d,
                    state: CardState::Review,
                    step_index: None,
                    rating,
                    days_elapsed: 3,
                    cumulative_step_days: 0,
                },
                &config,
            )
            .unwrap();
            s = o.stability;
            d = o.difficulty;
        }
        results.push((rating, s));
    }
    // Easy > Good > Hard
    assert!(
        results[0].1 < results[1].1,
        "Hard S={:.2} < Good S={:.2}",
        results[0].1,
        results[1].1
    );
    assert!(
        results[1].1 < results[2].1,
        "Good S={:.2} < Easy S={:.2}",
        results[1].1,
        results[2].1
    );
}

// ── 4. Relearning ──

#[test]
fn forget_in_review_triggers_relearning() {
    let _g = lock_params();
    let config = test_config();
    let outcome = schedule(
        ScheduleInput {
            s_old: 5.0,
            d_old: 5.0,
            state: CardState::Review,
            step_index: None,
            rating: 1,
            days_elapsed: 5,
            cumulative_step_days: 0,
        },
        &config,
    )
    .unwrap();
    assert_eq!(outcome.state, CardState::Relearning);
    let secs = schedule_secs(5.0, 5.0, CardState::Review, None, 1, 5);
    assert!(secs <= 3600.0);
}

#[test]
fn relearn_then_recover() {
    let _g = lock_params();
    let config = test_config();
    let o1 = schedule(
        ScheduleInput {
            s_old: 5.0,
            d_old: 5.0,
            state: CardState::Review,
            step_index: None,
            rating: 1,
            days_elapsed: 5,
            cumulative_step_days: 0,
        },
        &config,
    )
    .unwrap();
    assert_eq!(o1.state, CardState::Relearning);
    let o2 = schedule(
        ScheduleInput {
            s_old: o1.stability,
            d_old: o1.difficulty,
            state: o1.state,
            step_index: Some(0),
            rating: 3,
            days_elapsed: 1,
            cumulative_step_days: 1,
        },
        &config,
    )
    .unwrap();
    assert_eq!(o2.state, CardState::Review);
}

#[test]
fn relearn_min_step_protects_early_good() {
    let _g = lock_params();
    let config = test_config();
    // relearn_steps = [600]：不足 600s 时返回剩余秒数
    assert_eq!(
        relearn_min_step_remaining(Some(0), 3, 0, &config),
        Some(600)
    );
    assert_eq!(
        relearn_min_step_remaining(Some(0), 4, 120, &config),
        Some(480)
    );
    // 已过完整步进：放行毕业
    assert_eq!(relearn_min_step_remaining(Some(0), 3, 600, &config), None);
    // Again/Hard 不需要保护（它们本来就留在 Relearning）
    assert_eq!(relearn_min_step_remaining(Some(0), 1, 0, &config), None);
    assert_eq!(relearn_min_step_remaining(Some(0), 2, 0, &config), None);
}

#[test]
fn relearn_graduation_uses_minimum_one_day_elapsed() {
    let _g = lock_params();
    let config = test_config();
    // 秒级 elapsed 被前端重插加速的场景：Good 不应给出 17h 这种短间隔
    let outcome = schedule(
        ScheduleInput {
            s_old: 5.0,
            d_old: 5.0,
            state: CardState::Relearning,
            step_index: Some(0),
            rating: 3,
            days_elapsed: 0,
            cumulative_step_days: 0,
        },
        &config,
    )
    .unwrap();
    assert_eq!(outcome.state, CardState::Review);
    let now = Utc::now();
    let due = chrono::DateTime::parse_from_rfc3339(&outcome.due_at)
        .unwrap()
        .with_timezone(&Utc);
    let secs = (due - now).num_seconds() as f64;
    assert!(
        secs >= 86400.0,
        "重学毕业间隔应至少 1 天（避免短期记忆立即毕业），实际 {:.1}h",
        secs / 3600.0
    );
}

// ── 5. Preview ──

#[test]
fn preview_returns_four_intervals() {
    let _g = lock_params();
    let config = test_config();
    let iv = preview(5.0, 5.0, CardState::Review, None, 5, 0, &config).unwrap();
    assert_eq!(iv.len(), 4);
    assert!(iv[0] < iv[1] && iv[1] < iv[2] && iv[2] < iv[3]);
}

#[test]
fn preview_review_card_with_days_elapsed() {
    let _g = lock_params();
    let config = test_config();
    let iv0 = preview(2.0, 5.0, CardState::Review, None, 0, 0, &config).unwrap();
    let iv5 = preview(2.0, 5.0, CardState::Review, None, 5, 0, &config).unwrap();
    assert_eq!(iv0[0], 60.0);
    assert_eq!(iv5[0], 60.0);
    assert!(iv0[2] < iv5[2]);
}

#[test]
fn preview_relearning_early_good_shows_remaining_step() {
    let _g = lock_params();
    let config = test_config();
    // 10 分钟步进只过了 60s：Good/Easy 应显示剩余 540s，而不是毕业间隔
    let iv = preview(5.0, 5.0, CardState::Relearning, Some(0), 0, 60, &config).unwrap();
    assert_eq!(iv[0], 600.0);
    assert_eq!(iv[1], 600.0);
    assert_eq!(iv[2], 540.0);
    assert_eq!(iv[3], 540.0);
}

#[test]
fn preview_relearning_full_step_shows_min_one_day_graduation() {
    let _g = lock_params();
    let config = test_config();
    // 步进已走完：Good/Easy 显示毕业间隔，且不应再是 17h 这种短间隔
    let iv = preview(5.0, 5.0, CardState::Relearning, Some(0), 0, 600, &config).unwrap();
    assert_eq!(iv[0], 600.0);
    assert!(
        iv[2] >= 86400.0,
        "Good 预览应 ≥1 天，实际 {:.1}h",
        iv[2] / 3600.0
    );
    assert!(
        iv[3] >= 86400.0,
        "Easy 预览应 ≥1 天，实际 {:.1}h",
        iv[3] / 3600.0
    );
}

// ── 6. 长期增长 ──

#[test]
fn long_term_growth_trajectory() {
    let _g = lock_params();
    let config = test_config();
    let mut s = 0.0;
    let mut d = 0.0;
    let mut state = CardState::New;

    // Step 0 → 1（步进不更新 S/D）
    let o1 = schedule(
        ScheduleInput {
            s_old: s,
            d_old: d,
            state,
            step_index: None,
            rating: 3,
            days_elapsed: 0,
            cumulative_step_days: 0,
        },
        &config,
    )
    .unwrap();
    (s, d, state) = (o1.stability, o1.difficulty, o1.state);
    // Step 1 → 毕业（用 cumulative_step_days=1）
    let o2 = schedule(
        ScheduleInput {
            s_old: s,
            d_old: d,
            state,
            step_index: Some(1),
            rating: 3,
            days_elapsed: 0,
            cumulative_step_days: 1,
        },
        &config,
    )
    .unwrap();
    (s, d, state) = (o2.stability, o2.difficulty, o2.state);
    assert_eq!(state, CardState::Review, "应毕业到 Review");

    let mut de = 1u32;
    for _ in 0..20 {
        let o = schedule(
            ScheduleInput {
                s_old: s,
                d_old: d,
                state,
                step_index: None,
                rating: 3,
                days_elapsed: de,
                cumulative_step_days: 0,
            },
            &config,
        )
        .unwrap();
        s = o.stability;
        d = o.difficulty;
        de = interval_days(s).max(1.0) as u32;
    }
    assert!(
        interval_days(s) >= 10.0,
        "20次后间隔={:.1}",
        interval_days(s)
    );
}

// ── 7. de 排序 ──

#[test]
fn days_elapsed_0_vs_1_vs_7_vs_30() {
    let _g = lock_params();
    for de in [0u32, 1, 3, 7, 30] {
        let ratings: Vec<f64> = (1..=4)
            .map(|r| schedule_secs(2.0, 5.0, CardState::Review, None, r, de))
            .collect();
        assert!(ratings[0] < ratings[1], "de={de}: Again < Hard");
        assert!(ratings[1] < ratings[2], "de={de}: Hard < Good");
        assert!(ratings[2] < ratings[3], "de={de}: Good < Easy");
    }
}

// ── 8. 真实记忆模型模拟 ──

use rand::rngs::StdRng;

fn true_rating(true_stability: f64, days_elapsed: u32, rng: &mut impl Rng) -> u8 {
    if days_elapsed == 0 {
        return 3;
    }
    let recall_prob = 2.0_f64.powf(-(days_elapsed as f64) / true_stability);
    let recalled: bool = rng.random::<f64>() < recall_prob;
    if !recalled {
        1
    } else {
        let p: f64 = rng.random();
        if p < 0.15 {
            2
        } else if p < 0.75 {
            3
        } else {
            4
        }
    }
}

struct TrueMemSim {
    sys_s: f64,
    sys_d: f64,
    sys_state: CardState,
    sys_step: Option<usize>,
    true_s: f64,
    /// 累积步进时间（秒）——进入当前 step 阶段后的总时间
    step_cumulative_secs: i64,
    reviews: u32,
    lapses: u32,
    config: SchedulerConfig,
}

impl TrueMemSim {
    fn new(true_stability: f64) -> Self {
        Self {
            sys_s: 0.0,
            sys_d: 0.0,
            sys_state: CardState::New,
            sys_step: None,
            true_s: true_stability,
            step_cumulative_secs: 0,
            reviews: 0,
            lapses: 0,
            config: SchedulerConfig::default(),
        }
    }

    fn current_interval_days(&self) -> f64 {
        if self.sys_state == CardState::Review {
            interval_days(self.sys_s)
        } else {
            0.1
        }
    }

    fn review(&mut self, rng: &mut impl Rng) {
        let days_elapsed = if self.reviews == 0 {
            0
        } else if self.sys_state.has_steps() {
            // 步进阶段：不到 1 天，传 0
            0
        } else {
            (self.current_interval_days() as u32).max(1)
        };

        let cumulative_step_days = if self.sys_state.has_steps() || self.sys_state == CardState::New
        {
            (self.step_cumulative_secs / 86400).max(1) as u32
        } else {
            days_elapsed
        };

        let rating = true_rating(self.true_s, days_elapsed.max(1), rng);

        let outcome = schedule(
            ScheduleInput {
                s_old: self.sys_s,
                d_old: self.sys_d,
                state: self.sys_state,
                step_index: self.sys_step,
                rating,
                days_elapsed,
                cumulative_step_days,
            },
            &self.config,
        )
        .unwrap();
        self.sys_s = outcome.stability;
        self.sys_d = outcome.difficulty;
        self.sys_state = outcome.state;
        self.reviews += 1;
        self.step_cumulative_secs += days_elapsed.max(1) as i64 * 86400;

        if outcome.state.has_steps() {
            let old = self.sys_step.unwrap_or(0);
            self.sys_step = Some(match rating {
                1 => 0,
                _ => old + 1,
            });
        } else {
            self.sys_step = None;
            self.step_cumulative_secs = 0;
        }

        if rating == 1 {
            self.lapses += 1;
        }
    }

    fn finish_learning(&mut self, rng: &mut impl Rng) {
        while self.sys_state != CardState::Review {
            self.review(rng);
        }
    }

    fn run_reviews(&mut self, n: u32, rng: &mut impl Rng) {
        for _ in 0..n {
            self.review(rng);
        }
    }

    fn estimation_error(&self) -> f64 {
        if self.true_s > 0.0 {
            (self.sys_s - self.true_s).abs() / self.true_s
        } else {
            0.0
        }
    }
}

#[test]
fn true_memory_simulation_report() {
    let _g = lock_params();
    let mut rng = StdRng::seed_from_u64(42);

    let card_types = [
        ("容易 (S=30d)", 30.0_f64),
        ("中等 (S=10d)", 10.0_f64),
        ("困难 (S=3d)", 3.0_f64),
        ("极难 (S=1d)", 1.0_f64),
    ];

    println!("\n");
    println!("{:=<100}", "");
    println!("{:^100}", "真实记忆模型模拟");
    println!("{:=<100}", "");
    println!();
    println!("{:─^100}", " 模拟参数 ");
    println!("  R = 2^(-days_elapsed / S_true)");
    println!("  回忆成功 → Good (70%) / Easy (15%) / Hard (15%)");
    println!("  回忆失败 → Again");
    println!("  每类 200 张卡，学习→毕业→30次 Review");
    println!("  步进阶段不更新 S/D，毕业时用累积时间 (cumulative_step_days)");
    println!();

    println!(
        "{:<12} {:<10} {:<12} {:<14} {:<14} {:<14} {:<14}",
        "卡片难度", "S_true", "遗忘率", "最终间隔(d)", "FSRS估计S", "估计误差 %", ">30d占比"
    );
    println!(
        "{:-<12} {:-<10} {:-<12} {:-<14} {:-<14} {:-<14} {:-<14}",
        "", "", "", "", "", "", ""
    );

    for &(name, true_s) in &card_types {
        let mut total_lapses = 0u64;
        let mut total_reviews = 0u64;
        let mut final_intervals = Vec::new();
        let mut final_sys_s = Vec::new();
        let mut errors = Vec::new();
        let mut over_30d = 0u32;

        for _ in 0..200 {
            let mut sim = TrueMemSim::new(true_s);
            sim.finish_learning(&mut rng);
            sim.run_reviews(30, &mut rng);

            total_lapses += sim.lapses as u64;
            total_reviews += sim.reviews as u64;
            final_intervals.push(sim.current_interval_days());
            final_sys_s.push(sim.sys_s);
            errors.push(sim.estimation_error());

            if sim.current_interval_days() >= 30.0 {
                over_30d += 1;
            }
        }

        let lapse_rate = total_lapses as f64 / total_reviews as f64;
        let avg_iv = final_intervals.iter().sum::<f64>() / 200.0;
        let avg_sys = final_sys_s.iter().sum::<f64>() / 200.0;
        let avg_err = errors.iter().sum::<f64>() / 200.0 * 100.0;
        let pct_30d = over_30d as f64 / 200.0 * 100.0;

        println!(
            "{:<12} {:<10.0} {:<11.1}% {:<14.1} {:<14.2} {:<13.1}% {:<13.1}%",
            name,
            true_s,
            lapse_rate * 100.0,
            avg_iv,
            avg_sys,
            avg_err,
            pct_30d
        );
    }

    println!();
    println!("{:─^100}", " 单卡轨迹 ");
    println!();

    for &(name, true_s) in &card_types {
        let mut sim = TrueMemSim::new(true_s);
        sim.finish_learning(&mut rng);

        print!("{name:<12} ");
        for i in 1..=12 {
            sim.review(&mut rng);
            if sim.sys_state == CardState::Review {
                print!("#{}={:.0}d ", i, sim.current_interval_days().max(0.1));
            } else {
                print!("#{i}=step ");
            }
        }
        println!();
    }

    println!();
    println!("{:─^100}", " 验证：cumulative_step_days ");
    println!("  步进阶段不调 FSRS，毕业时用累积经过天数算间隔。");
    println!("  期望：FSRS 收到正确的累积天数 → 稳定性估计更准确。");
}

#[test]
fn true_memory_simulation_check() {
    let _g = lock_params();
    let mut rng = StdRng::seed_from_u64(123);
    let mut total_s = 0.0;
    for _ in 0..50 {
        let mut sim = TrueMemSim::new(5.0);
        sim.finish_learning(&mut rng);
        sim.run_reviews(10, &mut rng);
        total_s += sim.sys_s;
    }
    let avg_s = total_s / 50.0;
    eprintln!("50 张卡 10 次 review 后平均 S={avg_s:.2}");
    // 系统应学到一些稳定性（> 初始值 0）
    assert!(avg_s > 0.1, "S 应 > 0: {avg_s}");
}

// ── 9. 配置验证 ──

#[test]
fn custom_config_produces_different_intervals() {
    let _g = lock_params();
    let default = SchedulerConfig::default();
    let fast = SchedulerConfig {
        learning_steps: vec![30, 120],
        relearn_steps: vec![60, 300],
        graduating_interval_secs: 43200,
        desired_retention: 0.85,
        fsrs_params: vec![],
    };
    let now = Utc::now();

    // 学习步进不同 → 步进间隔不同
    let d1 = schedule(
        ScheduleInput {
            s_old: 0.0,
            d_old: 0.0,
            state: CardState::New,
            step_index: None,
            rating: 3,
            days_elapsed: 0,
            cumulative_step_days: 0,
        },
        &default,
    )
    .unwrap();
    let f1 = schedule(
        ScheduleInput {
            s_old: 0.0,
            d_old: 0.0,
            state: CardState::New,
            step_index: None,
            rating: 3,
            days_elapsed: 0,
            cumulative_step_days: 0,
        },
        &fast,
    )
    .unwrap();
    // 默认 [60, 600]，第一个 step 后 due 在 STEPS[1]=600s
    // 快速 [30, 120]，第一个 step 后 due 在 120s
    let d_due = chrono::DateTime::parse_from_rfc3339(&d1.due_at)
        .unwrap()
        .with_timezone(&Utc);
    let f_due = chrono::DateTime::parse_from_rfc3339(&f1.due_at)
        .unwrap()
        .with_timezone(&Utc);
    let d_step = (d_due - now).num_seconds();
    let f_step = (f_due - now).num_seconds();
    assert!(
        d_step != f_step,
        "不同步进应产生不同间隔: {d_step}s vs {f_step}s"
    );
    eprintln!("默认步进: {d_step}s, 快速步进: {f_step}s");
}

// ── 全局参数运行时更新 ──
//
// 这些测试会短暂修改 `GLOBAL_FSRS_PARAMS`，然后立即恢复为空。
// 窗口极小（set → assert → restore 在同一线程连续执行），
// 并行测试几乎不可能在窗口内读到脏数据。
//
// 使用的参数值必须能被 FSRS 接受，避免 InvalidParameters 错误
// 污染并行的其他测试。这里使用默认 FSRS 参数（19 个 f32）。
