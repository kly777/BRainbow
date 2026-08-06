use sqlx::SqlitePool;
use std::sync::Arc;

use crate::batch::{BatchResponse, batch_execute, batch_execute_with_code};
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::port::MemRepository;

#[derive(Clone)]
pub struct MemService {
    repo: Arc<dyn MemRepository>,
    /// 数据库连接池（临时保留，供 optimizer 使用。TODO: Phase 2 — 让 optimizer 也通过 Repository trait 访问）
    db: Arc<SqlitePool>,
}

impl MemService {
    pub fn new(repo: Arc<dyn MemRepository>, db: Arc<SqlitePool>) -> Self {
        Self { repo, db }
    }

    // ── 获取学习池（含侧面：新卡标注 learning 状态） ──

    pub async fn get_due(
        &self,
        max_learning: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<DueResponse, sqlx::Error> {
        let cap = max_learning as usize;
        let mut ids: Vec<i32> = Vec::with_capacity(cap);

        // 1. 学习卡优先：learning + relearning（按 due_at 排序）
        let learning = self
            .repo
            .get_learning_mems(max_learning, tag_ids, exclude_tag_ids)
            .await?;
        for id in &learning {
            if ids.len() < cap {
                ids.push(*id);
            }
        }
        let more_to_learn = learning.len() > ids.len();

        // 2. 到期 review 填空
        let review_quota = cap.saturating_sub(ids.len());
        if review_quota > 0 {
            let due = self
                .repo
                .get_due_reviews(review_quota as i64, tag_ids, exclude_tag_ids)
                .await?;
            ids.extend(due);
        }

        // 3. 新卡填空（标注 learning 状态——这是写操作）
        let new_quota = cap.saturating_sub(ids.len());
        if new_quota > 0 {
            let new_cards = self
                .repo
                .get_new_cards(new_quota as i64, tag_ids, exclude_tag_ids)
                .await?;
            for id in &new_cards {
                self.repo.set_state(*id, "learning", Some(0)).await?;
            }
            ids.extend(new_cards);
        }

        // 4. 提前复习 (upcoming) 填空
        let upcoming_quota = cap.saturating_sub(ids.len());
        if upcoming_quota > 0 {
            let upcoming = self
                .repo
                .get_upcoming_reviews(upcoming_quota as i64, tag_ids)
                .await?;
            ids.extend(upcoming);
        }

        // 5. 实在没卡了，随便给一张
        if ids.is_empty()
            && let Ok(Some(id)) = self.repo.get_next_mem().await
        {
            ids.push(id);
        }

        let items = self.build_items(&ids).await;
        let has_more = more_to_learn || ids.len() >= cap;
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
            items: items.into(),
            due_count: ids.len(),
            has_more,
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
                &FsrsUpdate {
                    state: new_state.to_string(),
                    stability: outcome.stability,
                    difficulty: outcome.difficulty,
                    step_index: new_step.map(|s| s as i32),
                    lapses,
                    leeched,
                    due_at: outcome.due_at.clone(),
                },
            )
            .await?;

        // 写 revlog（通过 Repository trait）
        let delta_t = days_elapsed_since(&row.last_review_at) as i32;
        let now_str = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        self.repo
            .insert_revlog(&InsertRevlogParams {
                mem_id: id,
                review_time: now_str,
                rating,
                delta_t,
                stability_before: row.stability,
                difficulty_before: row.difficulty,
                state_before: row.state.clone(),
                stability_after: outcome.stability,
                difficulty_after: outcome.difficulty,
                state_after: new_state.to_string(),
            })
            .await
            .map_err(AppError::Db)?;

        // 每 20 次复习自动触发一次参数优化
        let repo = self.repo.clone();
        let db = self.db.clone();
        tokio::spawn(async move {
            maybe_auto_optimize(repo, db, 20).await;
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
        let cumulative_step_days = days_elapsed;
        fsrs::schedule(
            fsrs::ScheduleInput {
                s_old: row.stability,
                d_old: row.difficulty,
                state,
                step_index: step,
                rating,
                days_elapsed,
                cumulative_step_days,
            },
            &config,
        )
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

    // ── 批量操作 ──

    pub async fn batch_delete(&self, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo.delete_mem(id).await.map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    pub async fn batch_bury(&self, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo.bury_mem(id).await.map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    pub async fn batch_reset(&self, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo.reset_mem(id).await.map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    // ── CRUD ──

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
                &FsrsUpdate {
                    state: req.state.clone(),
                    stability: req.stability,
                    difficulty: req.difficulty,
                    step_index: req.step_index,
                    lapses: req.lapses,
                    leeched: req.leeched,
                    due_at: req.due_at.clone(),
                },
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

    // ── 标签 ──

    pub async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, AppError> {
        self.repo
            .create_tag(name, user_id)
            .await
            .map_err(AppError::Db)
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), AppError> {
        self.repo.delete_tag(id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), AppError> {
        self.repo.get_mem(mem_id).await?.ok_or(AppError::NotFound)?;
        self.repo
            .add_tag_to_mem(mem_id, tag_id)
            .await
            .map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), AppError> {
        self.repo
            .remove_tag_from_mem(mem_id, tag_id)
            .await
            .map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), AppError> {
        self.repo.get_mem(mem_id).await?.ok_or(AppError::NotFound)?;
        self.repo
            .set_mem_tags(mem_id, tag_ids)
            .await
            .map_err(AppError::Db)?;
        Ok(())
    }

    // ── 批量标签 ──

    pub async fn batch_add_tag_to_mems(&self, mem_ids: &[i32], tag_id: i32) -> BatchResponse {
        let (_, errors) = batch_execute_with_code(mem_ids.iter().copied(), |mem_id| async move {
            self.repo
                .add_tag_to_mem(mem_id, tag_id)
                .await
                .map_err(|e| ("DB_ERROR", format!("{e}")))
        })
        .await;
        BatchResponse::from_results(errors, mem_ids.len())
    }

    pub async fn batch_remove_tag_from_mems(&self, mem_ids: &[i32], tag_id: i32) -> BatchResponse {
        let (_, errors) = batch_execute_with_code(mem_ids.iter().copied(), |mem_id| async move {
            self.repo
                .remove_tag_from_mem(mem_id, tag_id)
                .await
                .map_err(|e| ("DB_ERROR", format!("{e}")))
        })
        .await;
        BatchResponse::from_results(errors, mem_ids.len())
    }

    pub async fn batch_set_tags_for_mems(&self, mem_ids: &[i32], tag_ids: &[i32]) -> BatchResponse {
        let tag_ids = tag_ids.to_vec();
        let (_, errors) = batch_execute_with_code(mem_ids.iter().copied(), |mem_id| {
            let tag_ids = tag_ids.clone();
            async move {
                self.repo
                    .set_mem_tags(mem_id, &tag_ids)
                    .await
                    .map_err(|e| ("DB_ERROR", format!("{e}")))
            }
        })
        .await;
        BatchResponse::from_results(errors, mem_ids.len())
    }

    // ── CSV/JSON 导入 ──

    /// 导入为 CSV（逗号分隔）
    pub async fn import_csv(
        &self,
        csv_data: &str,
        user_id: i32,
        default_tags: &[String],
    ) -> Result<(usize, Vec<String>), AppError> {
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_data.as_bytes());
        self.import_records(&mut reader, user_id, default_tags)
            .await
    }

    /// 导入为 PSV（竖线分隔）
    pub async fn import_psv(
        &self,
        psv_data: &str,
        user_id: i32,
        default_tags: &[String],
    ) -> Result<(usize, Vec<String>), AppError> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b'|')
            .has_headers(true)
            .flexible(true)
            .from_reader(psv_data.as_bytes());
        self.import_records(&mut reader, user_id, default_tags)
            .await
    }

    /// 导入逻辑复用
    async fn import_records(
        &self,
        reader: &mut csv::Reader<&[u8]>,
        user_id: i32,
        default_tags: &[String],
    ) -> Result<(usize, Vec<String>), AppError> {
        let mut count = 0usize;
        let mut errors = Vec::new();

        for (i, result) in reader.records().enumerate() {
            match result {
                Ok(record) => {
                    let cue = record.get(0).unwrap_or("");
                    let target = record.get(1).unwrap_or("");
                    let tags_str = record.get(2).unwrap_or("");

                    if cue.trim().is_empty() || target.trim().is_empty() {
                        errors.push(format!("行 {}: 线索或答案为空", i + 2));
                        continue;
                    }

                    let cue_id = self.repo.create_chunk(cue).await.map_err(AppError::Db)?;
                    let target_id = self.repo.create_chunk(target).await.map_err(AppError::Db)?;
                    let mem_id = self
                        .repo
                        .create_mem(cue_id, target_id, &[])
                        .await
                        .map_err(AppError::Db)?;

                    self.apply_tags_to_mem(mem_id, tags_str, default_tags, user_id)
                        .await?;

                    count += 1;
                }
                Err(e) => {
                    errors.push(format!("行 {}: {}", i + 2, e));
                }
            }
        }

        Ok((count, errors))
    }

    async fn apply_tags_to_mem(
        &self,
        mem_id: i32,
        tags_str: &str,
        default_tags: &[String],
        user_id: i32,
    ) -> Result<(), AppError> {
        let mut all_names: Vec<String> = tags_str
            .split([';', ','])
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        for dt in default_tags {
            if !all_names.contains(dt) {
                all_names.push(dt.clone());
            }
        }
        for name in &all_names {
            let tag = match self
                .repo
                .search_tags(user_id, name)
                .await
                .map_err(AppError::Db)?
                .into_iter()
                .find(|t| t.name == *name)
            {
                Some(t) => t,
                None => self
                    .repo
                    .create_tag(name, user_id)
                    .await
                    .map_err(AppError::Db)?,
            };
            self.repo
                .add_tag_to_mem(mem_id, tag.id)
                .await
                .map_err(AppError::Db)?;
        }
        Ok(())
    }

    /// 从 JSON 导入
    pub async fn import_json(
        &self,
        mems: &[JsonMemItem],
        user_id: i32,
        default_tags: &[String],
    ) -> Result<(usize, Vec<String>), AppError> {
        let mut count = 0usize;
        let mut errors = Vec::new();

        for (i, item) in mems.iter().enumerate() {
            let cue = item.cue.trim();
            let target = item.target.trim();

            if cue.is_empty() || target.is_empty() {
                errors.push(format!("项 {}: 线索或答案为空", i + 1));
                continue;
            }

            let cue_id = self.repo.create_chunk(cue).await.map_err(AppError::Db)?;
            let target_id = self.repo.create_chunk(target).await.map_err(AppError::Db)?;
            let mem_id = self
                .repo
                .create_mem(cue_id, target_id, &[])
                .await
                .map_err(AppError::Db)?;

            let tags_str = item.tags.join("; ");
            self.apply_tags_to_mem(mem_id, &tags_str, default_tags, user_id)
                .await?;

            count += 1;
        }

        Ok((count, errors))
    }

    // ── 助记 ──

    pub async fn set_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), sqlx::Error> {
        self.repo.upsert_mnemonic(mem_id, content).await
    }
}

/// 如果 revlog 条数达到 `every` 的整数倍，自动触发 FSRS 参数优化。
async fn maybe_auto_optimize(repo: Arc<dyn MemRepository>, db: Arc<SqlitePool>, every: i64) {
    let count = match repo.count_revlogs().await {
        Ok(n) => n,
        Err(_) => return,
    };
    if count < 10 || count % every != 0 {
        return;
    }

    tracing::info!("触发自动优化: revlog 共 {} 条", count);
    let config = MemConfig::load();
    match crate::modules::mem::optimizer::optimize_fsrs_params(&db, &config).await {
        Ok(Some(params)) => {
            let mut cfg = config;
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
            tracing::warn!("自动优化失败: {e}");
        }
    }

    if let Err(e) = repo.prune_revlogs().await {
        tracing::warn!("revlog 修剪失败: {e}");
    }
}
