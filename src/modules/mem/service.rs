use sqlx::SqlitePool;
use std::sync::Arc;

use crate::modules::mem::config::MemConfig;
use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::repository::{MemRepo, MemRow};

/// 计算自上次复习以来经过的天数。
/// 新卡（无 last_review_at）返回 0。
/// 已复习过的卡即使不到 1 天也返回至少 1，
/// 确保 FSRS 收到非零 days_elapsed 从而正确更新 stability。
fn days_elapsed_since(last_review_at: &Option<String>) -> u32 {
    match last_review_at {
        None => 0,
        Some(s) => {
            if let Ok(t) = chrono::DateTime::parse_from_rfc3339(s) {
                let t_utc = t.with_timezone(&chrono::Utc);
                let elapsed = chrono::Utc::now() - t_utc;
                let days = elapsed.num_seconds() / 86400;
                std::cmp::max(1, days as u32)
            } else {
                1
            }
        }
    }
}

pub struct MemService {
    repo: MemRepo,
}

impl MemService {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self {
            repo: MemRepo::new(pool),
        }
    }

    // ── 获取学习池 ──

    pub async fn get_due(&self, max_learning: i64) -> Result<DueResponse, sqlx::Error> {
        let mut ids = self.repo.get_learning_mems(max_learning).await?;
        let pool_count = ids.len();

        if pool_count < max_learning as usize {
            let needed = max_learning as usize - pool_count;
            let due_reviews = self.repo.get_due_reviews(needed as i64).await?;
            ids.extend(due_reviews);
        }

        if ids.len() < max_learning as usize {
            let needed = max_learning as usize - ids.len();
            let new_cards = self.repo.get_new_cards(needed as i64).await?;
            for id in &new_cards {
                self.repo.set_state(*id, "learning", Some(0)).await?;
            }
            ids.extend(new_cards);
        }

        if ids.len() < max_learning as usize {
            let needed = max_learning as usize - ids.len();
            let upcoming = self.repo.get_upcoming_reviews(needed as i64).await?;
            ids.extend(upcoming);
        }

        if ids.is_empty() {
            if let Ok(Some(id)) = self.repo.get_next_mem().await {
                ids.push(id);
            }
        }

        let items = self.build_items(&ids).await;
        let has_more = ids.len() >= max_learning as usize;
        let upcoming_count = if ids.is_empty() {
            self.repo.count_upcoming().await.unwrap_or(0) as usize
        } else {
            0
        };
        let all_far = !items.is_empty()
            && items.iter().all(|it| {
                chrono::DateTime::parse_from_rfc3339(&it.due_at)
                    .map(|t| t > chrono::Utc::now() + chrono::Duration::hours(24))
                    .unwrap_or(false)
            });
        Ok(DueResponse {
            due_count: items.len(),
            has_more,
            items,
            upcoming_count,
            all_far,
        })
    }

    // ── 复习 ──

    pub async fn review(&self, id: i32, rating: u8) -> Result<ReviewResponse, AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        let outcome = self.apply_review(&row, rating);

        let new_step = if outcome.state.has_steps() {
            let old = row.step_index.map(|i| i as usize);
            Some(match (old, rating) {
                (_, 1) => 0,
                (Some(s), _) => s + 1,
                (None, _) => 0,
            })
        } else {
            None
        };

        let new_state = outcome.state.as_str();

        let lapses = if rating == 1 {
            row.lapses + 1
        } else if rating <= 2 {
            row.lapses
        } else {
            0
        };
        let leeched = row.leeched || lapses >= 5;

        self.repo
            .update_mem_fsrs(
                id,
                new_state,
                outcome.stability,
                outcome.difficulty,
                new_step.map(|s| s as i32),
                lapses,
                leeched,
                &outcome.due_at,
            )
            .await?;

        // 写 revlog
        let delta_t = days_elapsed_since(&row.last_review_at) as i32;
        let now_str = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        sqlx::query(
            r#"
            INSERT INTO revlog (mem_id, review_time, rating, delta_t,
                stability_before, difficulty_before, state_before,
                stability_after, difficulty_after, state_after)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(id)
        .bind(&now_str)
        .bind(rating as i32)
        .bind(delta_t)
        .bind(row.stability)
        .bind(row.difficulty)
        .bind(&row.state)
        .bind(outcome.stability)
        .bind(outcome.difficulty)
        .bind(new_state)
        .execute(&*self.repo.pool)
        .await
        .map_err(AppError::Db)?;

        // 每 20 次复习自动触发一次参数优化
        let pool = self.repo.pool.clone();
        tokio::spawn(async move {
            maybe_auto_optimize(pool, 20).await;
        });

        Ok(ReviewResponse {
            state: new_state.to_string(),
            due_at: outcome.due_at,
        })
    }

    fn apply_review(&self, row: &MemRow, rating: u8) -> ReviewOutcome {
        let state: CardState = row.state.parse().unwrap_or(CardState::New);
        let step = if state == CardState::New {
            Some(0)
        } else {
            row.step_index.map(|i| i as usize)
        };
        let days_elapsed = days_elapsed_since(&row.last_review_at);
        let config = fsrs::SchedulerConfig::default();
        let cumulative_step_days = if state.has_steps() || state == CardState::New {
            days_elapsed.max(1)
        } else {
            days_elapsed
        };
        fsrs::schedule(
            row.stability,
            row.difficulty,
            state,
            step,
            rating,
            chrono::Utc::now(),
            days_elapsed,
            cumulative_step_days,
            &config,
        )
    }

    // ── 其他 ──

    async fn build_items(&self, ids: &[i32]) -> Vec<MemWithChunks> {
        let mut items = Vec::new();
        for &id in ids {
            if let Ok(Some(row)) = self.repo.get_mem(id).await {
                if let (Ok(Some(cue)), Ok(Some(target))) = (
                    self.repo.get_chunk(row.cue_chunk_id).await,
                    self.repo.get_chunk(row.target_chunk_id).await,
                ) {
                    items.push(MemWithChunks {
                        id: row.id,
                        cue,
                        target,
                        state: row.state,
                        stability: row.stability,
                        difficulty: row.difficulty,
                        due_at: row.due_at,
                        lapses: row.lapses,
                        leeched: row.leeched,
                    });
                }
            }
        }
        items
    }

    pub async fn get_all(&self, limit: i64, offset: i64) -> Result<DueResponse, sqlx::Error> {
        let ids = self.repo.get_all_mems(limit, offset).await?;
        let items = self.build_items(&ids).await;
        Ok(DueResponse {
            due_count: items.len(),
            has_more: false,
            upcoming_count: 0,
            all_far: false,
            items,
        })
    }

    /// 获取各状态计数（新卡 / 学习中 / 待复习 / 已埋葬）
    pub async fn get_counts(&self) -> Result<MemCounts, sqlx::Error> {
        let (new_count, learning_count, due_count, buried_count, suspended_count) =
            self.repo.get_counts().await?;
        Ok(MemCounts {
            new: new_count as usize,
            learning: learning_count as usize,
            due: due_count as usize,
            buried: buried_count as usize,
            suspended: suspended_count as usize,
        })
    }

    pub async fn get_session_estimate(&self) -> Result<SessionEstimate, sqlx::Error> {
        let due_count = self.repo.count_due_total().await? as usize;
        let retention = self.repo.get_recent_retention(100).await?;
        let total_estimate = if retention > 0.0 {
            let raw = due_count as f64 / retention;
            // 保留至少 due_count，向上取整
            std::cmp::max(due_count, raw.ceil() as usize)
        } else {
            // 无历史数据时按 80% 估算
            (due_count as f64 / 0.8).ceil() as usize
        };
        Ok(SessionEstimate {
            due_count,
            retention,
            total_estimate,
        })
    }

    // ── 挂起 / 恢复 ──

    pub async fn suspend(&self, id: i32) -> Result<(), AppError> {
        self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        self.repo.suspend_mem(id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn unsuspend(&self, id: i32) -> Result<(), AppError> {
        self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        self.repo.unsuspend_mem(id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn preview(&self, id: i32) -> Result<[f64; 4], AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        let state: CardState = row.state.parse().unwrap_or(CardState::New);
        let days_elapsed = days_elapsed_since(&row.last_review_at);
        let config = fsrs::SchedulerConfig::default();
        Ok(fsrs::preview(
            row.stability,
            row.difficulty,
            state,
            row.step_index.map(|i| i as usize),
            days_elapsed,
            &config,
        ))
    }

    pub async fn create(&self, req: CreateMemRequest) -> Result<i32, sqlx::Error> {
        let cue_id = self.repo.create_chunk(&req.cue_content).await?;
        let target_id = self.repo.create_chunk(&req.target_content).await?;
        self.repo
            .create_mem(cue_id, target_id, &req.prerequisites)
            .await
    }

    pub async fn undo(&self, id: i32, req: UndoRequest) -> Result<(), sqlx::Error> {
        self.repo
            .update_mem_fsrs(
                id,
                &req.state,
                req.stability,
                req.difficulty,
                req.step_index,
                req.lapses,
                req.leeched,
                &req.due_at,
            )
            .await
    }

    pub async fn edit(&self, id: i32, req: EditMemRequest) -> Result<(), AppError> {
        let row = self.repo.get_mem(id).await?.ok_or(AppError::NotFound)?;
        self.repo
            .update_chunk(row.cue_chunk_id, &req.cue_content)
            .await
            .map_err(AppError::Db)?;
        self.repo
            .update_chunk(row.target_chunk_id, &req.target_content)
            .await
            .map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn bury(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.bury_mem(id).await
    }
    pub async fn unbury(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.unbury_mem(id).await
    }
    pub async fn delete(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.delete_mem(id).await
    }
    pub async fn reset(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.reset_mem(id).await
    }
}

/// 如果 revlog 条数达到 `every` 的整数倍，自动触发 FSRS 参数优化。
async fn maybe_auto_optimize(pool: Arc<SqlitePool>, every: i64) {
    let count: Result<(i64,), _> = sqlx::query_as("SELECT COUNT(*) FROM revlog")
        .fetch_one(&*pool)
        .await;
    let count = match count {
        Ok((n,)) => n,
        Err(_) => return,
    };
    if count < 10 || count % every != 0 {
        return;
    }

    tracing::info!("触发自动优化: revlog 共 {} 条", count);
    let config = MemConfig::load();
    match crate::modules::mem::optimizer::optimize_fsrs_params(&pool, &config).await {
        Ok(Some(params)) => {
            let mut cfg = config;
            // 保存到文件 + 立即更新运行时参数
            let ok = cfg.update_fsrs_params(params.clone()).is_ok();
            crate::modules::mem::fsrs::set_global_params(params);
            if ok {
                tracing::info!("自动优化完成, 参数已更新 (文件 + 运行时)");
            } else {
                tracing::warn!("自动优化完成但保存文件失败, 仅运行时生效");
            }
        }
        Ok(None) => {}
        Err(e) => {
            tracing::warn!("自动优化失败: {}", e);
        }
    }
}

#[derive(Debug)]
pub enum AppError {
    NotFound,
    Db(sqlx::Error),
}
impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Db(e)
    }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppError::NotFound => write!(f, "not found"),
            AppError::Db(e) => write!(f, "db: {e}"),
        }
    }
}

impl AppError {
    pub fn into_response(self) -> axum::response::Response {
        match self {
            AppError::NotFound => crate::error::not_found("记忆项不存在"),
            AppError::Db(e) => crate::error::internal(e, "数据库操作"),
        }
    }
}
