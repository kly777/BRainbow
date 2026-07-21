use std::sync::Arc;

use crate::batch::BatchDataResponse;
use crate::modules::mem::fsrs;
use crate::modules::mem::model::*;
use crate::modules::mem::port::MemRepository;
use crate::pagination::{PaginatedResponse, Pagination};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：`MemQueryService` 只暴露不修改状态的读方法。
/// 写操作（包括 `get_due` 因其内部修改新卡状态）保留在 `MemService` 中。
#[derive(Clone)]
pub struct MemQueryService {
    repo: Arc<dyn MemRepository>,
}

impl MemQueryService {
    pub fn new(repo: Arc<dyn MemRepository>) -> Self {
        Self { repo }
    }

    // ── 管理列表 ──

    pub async fn get_all(
        &self,
        query: &MemQuery,
    ) -> Result<PaginatedResponse<MemWithChunks>, sqlx::Error> {
        let pagination = Pagination {
            page: query.page.unwrap_or(1),
            page_size: query.page_size.unwrap_or(50),
        };
        let (page, page_size) = pagination.clamp();
        let offset = (page - 1) * page_size;
        let ids = self.repo.get_all_mems(page_size, offset, query).await?;
        let items = self.build_items(&ids).await;
        let total = self.repo.count_all_mems(query).await?;
        let pagination_ref = &pagination;
        Ok(PaginatedResponse::new(items, total, pagination_ref))
    }

    // ── 统计 ──

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
        let (new_count, learning_count, due_count, _, _) = self.repo.get_counts().await?;
        let relearning_count = self.repo.count_relearning().await?;
        let pure_learning = learning_count - relearning_count;

        let retention = self.repo.get_recent_retention(100).await?;

        let config = crate::modules::mem::config::MemConfig::load();
        let step_count_learning = config.learning_steps.len();
        let step_count_relearning = config.relearn_steps.len();

        let new_total = new_count as usize * step_count_learning;

        let learning_remaining = if step_count_learning > 1 {
            step_count_learning / 2 + 1
        } else {
            1
        };
        let learning_total = pure_learning as usize * learning_remaining;

        let relearn_remaining = if step_count_relearning > 1 {
            step_count_relearning / 2 + 1
        } else {
            1
        };
        let relearning_total = relearning_count as usize * relearn_remaining;

        let fail_rate = if retention > 0.0 {
            1.0 - retention
        } else {
            0.2
        };
        let review_total = due_count as usize
            + (due_count as f64 * fail_rate * step_count_relearning as f64).ceil() as usize;

        let total_estimate = new_total + learning_total + relearning_total + review_total;
        let due_count_total = (new_count + learning_count + due_count) as usize;

        Ok(SessionEstimate {
            due_count: due_count_total,
            retention,
            total_estimate,
        })
    }

    // ── 预览 ──

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

    // ── 标签查询 ──

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, AppError> {
        self.repo.list_tags(user_id).await.map_err(AppError::Db)
    }

    pub async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, AppError> {
        self.repo
            .search_tags(user_id, q)
            .await
            .map_err(AppError::Db)
    }

    pub async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, AppError> {
        self.repo.get_mem_tags(mem_id).await.map_err(AppError::Db)
    }

    pub async fn get_mems_tags_batch(&self, mem_ids: &[i32]) -> BatchDataResponse<MemTagRow> {
        match self.repo.get_mems_tags_batch(mem_ids).await {
            Ok(items) => BatchDataResponse::all_ok(items),
            Err(e) => BatchDataResponse::from_results(
                vec![],
                vec![crate::batch::BatchErrorDetail {
                    index: 0,
                    code: "Internal Server Error".into(),
                    message: format!("数据库查询失败: {e}"),
                }],
                mem_ids.len(),
            ),
        }
    }

    // ── CSV/PSV 导出 ──

    pub async fn export_csv(&self, tag_ids: &[i32]) -> Result<String, AppError> {
        let rows = self
            .repo
            .export_all_mems(tag_ids)
            .await
            .map_err(AppError::Db)?;
        let mut wtr = csv::WriterBuilder::new()
            .delimiter(b'|')
            .from_writer(Vec::new());
        wtr.write_record(["cue", "target", "tags"])
            .map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;

        for (cue, target, tags) in &rows {
            wtr.write_record([cue, target, tags])
                .map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        }

        wtr.flush()
            .map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        let data = wtr
            .into_inner()
            .map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        String::from_utf8(data).map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))
    }

    // ── 助记 ──

    pub async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, sqlx::Error> {
        self.repo.get_mnemonic(mem_id).await
    }

    // ── upcoming ──

    pub async fn upcoming_counts(&self) -> Result<serde_json::Value, sqlx::Error> {
        let h8 = self.repo.count_upcoming_within_hours(8).await?;
        let h24 = self.repo.count_upcoming_within_hours(24).await?;
        Ok(serde_json::json!({"within_8h": h8, "within_24h": h24}))
    }

    // ── 内部辅助 ──

    async fn build_items(&self, ids: &[i32]) -> Vec<MemWithChunks> {
        let mut items = Vec::new();
        for &id in ids {
            if let Ok(Some(row)) = self.repo.get_mem(id).await
                && let (Ok(Some(cue)), Ok(Some(target))) = (
                    self.repo.get_chunk(row.cue_chunk_id).await,
                    self.repo.get_chunk(row.target_chunk_id).await,
                )
            {
                let mnemonic = self.repo.get_mnemonic(id).await.unwrap_or(None);
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
                    mnemonic,
                });
            }
        }
        items
    }
}
