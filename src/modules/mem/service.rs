use std::sync::Arc;

use crate::modules::mem::dto::*;
use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::port::{MemMaintenance, MemRepository};
use crate::modules::mem::selection;
use crate::shared::batch::{BatchResponse, batch_execute, batch_execute_with_code};
use crate::shared::error_types::ServiceError;
use crate::shared::time_text::ISO_UTC_FORMAT;

#[derive(Clone)]
pub struct MemService {
    repo: Arc<dyn MemRepository>,
    /// 后台维护（FSRS 参数优化）通过 port 注入，领域服务不持有数据库连接池。
    maintenance: Arc<dyn MemMaintenance>,
    /// 记忆配置（FSRS 参数 + 步进），调度时显式传入（不再有全局 static）。
    mem_config: Arc<crate::modules::mem::config::MemConfig>,
}

impl MemService {
    pub fn new(
        repo: Arc<dyn MemRepository>,
        maintenance: Arc<dyn MemMaintenance>,
        mem_config: Arc<crate::modules::mem::config::MemConfig>,
    ) -> Self {
        Self {
            repo,
            maintenance,
            mem_config,
        }
    }

    // ── 获取学习池（含侧面：新卡标注 learning 状态） ──

    pub async fn get_due(
        &self,
        user_id: i32,
        max_learning: i64,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<DueResponse, ServiceError> {
        let cap = max_learning as usize;
        let mut ids: Vec<i32> = Vec::with_capacity(cap);

        // 1. 学习卡优先：learning + relearning（按 due_at 排序）
        let learning = self
            .repo
            .get_learning_mems(user_id, max_learning, tag_ids, exclude_tag_ids)
            .await?;
        for id in &learning {
            if ids.len() < cap {
                ids.push(*id);
            }
        }
        let more_to_learn = learning.len() > ids.len();

        // 2. 到期 review 填空：难度/遗忘次数/过期程度加权采样
        let review_quota = cap.saturating_sub(ids.len());
        if review_quota > 0 {
            let candidates = self
                .repo
                .get_due_review_candidates(user_id, tag_ids, exclude_tag_ids)
                .await?;
            ids.extend(sample_review_candidates(&candidates, review_quota));
        }

        // 3. 新卡填空（标注 learning 状态——这是写操作）
        let new_quota = cap.saturating_sub(ids.len());
        if new_quota > 0 {
            let new_cards = self
                .repo
                .get_new_cards(user_id, new_quota as i64, tag_ids, exclude_tag_ids)
                .await?;
            for id in &new_cards {
                self.repo
                    .set_state(user_id, *id, "learning", Some(0))
                    .await?;
            }
            ids.extend(new_cards);
        }

        // 4. 提前复习 (upcoming) 填空：同样按难度/到期接近度加权采样
        let upcoming_quota = cap.saturating_sub(ids.len());
        if upcoming_quota > 0 {
            let candidates = self
                .repo
                .get_upcoming_review_candidates(user_id, tag_ids)
                .await?;
            ids.extend(sample_review_candidates(&candidates, upcoming_quota));
        }

        // 5. 实在没卡了，随便给一张
        if ids.is_empty()
            && let Some(id) = self.repo.get_next_mem(user_id).await?
        {
            ids.push(id);
        }

        let items = self.build_items(user_id, &ids).await?;
        let has_more = more_to_learn || ids.len() >= cap;
        let upcoming_count = if ids.is_empty() {
            self.repo.count_upcoming(user_id).await? as usize
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
            items,
            due_count: ids.len(),
            has_more,
            upcoming_count,
            all_far,
        })
    }

    // ── 复习 ──

    pub async fn review(
        &self,
        user_id: i32,
        id: i32,
        rating: u8,
        duration_secs: f64,
    ) -> Result<ReviewResponse, ServiceError> {
        let row = self
            .repo
            .get_mem(user_id, id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        let (outcome, new_step) = self
            .apply_review(&row, rating)
            .map_err(ServiceError::Internal)?;

        let new_state = outcome.state.as_str();

        // 仍在步进状态（Again/Hard，或提前 Good 被保护留在 Relearning）时保留 lapses，
        // 只有真正毕业回 Review 的 Good/Easy 才重置失败计数。
        let lapses = if rating == 1 {
            row.lapses + 1
        } else if rating <= 2 || new_state == "relearning" {
            row.lapses
        } else {
            0
        };
        let leeched = row.leeched || lapses >= 5;

        // FSRS 更新与 revlog 同事务提交；stability/last_review_at 双守卫做乐观锁，
        // 并发复习（双开标签页）时后到者收到冲突而非静默丢失更新（审计 B4）
        let revlog = InsertRevlogParams {
            mem_id: id,
            review_time: chrono::Utc::now()
                .format(ISO_UTC_FORMAT)
                .to_string(),
            rating,
            delta_t: days_elapsed_since(&row.last_review_at) as i32,
            duration_secs,
            stability_before: row.stability,
            difficulty_before: row.difficulty,
            state_before: row.state.clone(),
            stability_after: outcome.stability,
            difficulty_after: outcome.difficulty,
            state_after: new_state.to_string(),
        };
        let applied = self
            .repo
            .review_mem_atomic(
                user_id,
                id,
                &FsrsUpdate {
                    state: new_state.to_string(),
                    stability: outcome.stability,
                    difficulty: outcome.difficulty,
                    step_index: new_step,
                    lapses,
                    leeched,
                    due_at: outcome.due_at.clone(),
                },
                row.stability,
                row.last_review_at.as_deref(),
                &revlog,
            )
            .await?;
        if !applied {
            return Err(ServiceError::Conflict(
                "该记忆项刚被其他会话复习，请刷新后重试".into(),
            ));
        }

        // 每 20 次复习自动触发一次参数优化（策略在 adapter 内实现）
        self.maintenance.schedule_auto_optimize(self.repo.clone());

        Ok(ReviewResponse {
            state: new_state.to_string(),
            due_at: outcome.due_at,
        })
    }

    fn apply_review(
        &self,
        row: &MemRow,
        rating: u8,
    ) -> Result<(ReviewOutcome, Option<i32>), String> {
        let state: CardState = row.state.parse().unwrap_or(CardState::New);
        let step = if state == CardState::New {
            Some(0)
        } else {
            row.step_index.map(|i| i as usize)
        };
        let days_elapsed = days_elapsed_since(&row.last_review_at);
        let elapsed_secs = elapsed_secs_since(&row.last_review_at);
        let config = fsrs::SchedulerConfig {
            learning_steps: self.mem_config.learning_steps.clone(),
            relearn_steps: self.mem_config.relearn_steps.clone(),
            graduating_interval_secs: self.mem_config.graduating_interval_secs,
            desired_retention: self.mem_config.desired_retention,
            fsrs_params: self.mem_config.fsrs_params.clone(),
        };
        let cumulative_step_days = days_elapsed;
        let mut outcome = fsrs::schedule(
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
        )?;

        let mut new_step: Option<i32> = if outcome.state.has_steps() {
            let old = row.step_index.map(|i| i as usize);
            Some(match (old, rating) {
                (_, 1) | (None, _) => 0,
                (Some(s), _) => (s + 1) as i32,
            })
        } else {
            None
        };

        // Relearning 最低步进保护：前端会话内重插后，几秒内点 Good/Easy
        // 不算通过 10 分钟重学步进——留在 Relearning，等剩余时间走完再毕业。
        if state == CardState::Relearning
            && let Some(remaining) = fsrs::relearn_min_step_remaining(
                row.step_index.map(|i| i as usize),
                rating,
                elapsed_secs,
                &config,
            )
        {
            outcome = ReviewOutcome {
                state: CardState::Relearning,
                stability: row.stability,
                difficulty: row.difficulty,
                due_at: (chrono::Utc::now() + chrono::Duration::seconds(remaining))
                    .format(ISO_UTC_FORMAT)
                    .to_string(),
            };
            new_step = row.step_index;
        }

        Ok((outcome, new_step))
    }

    // ── 内部辅助 ──

    async fn build_items(
        &self,
        user_id: i32,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, ServiceError> {
        self.repo.get_mems_with_chunks(user_id, ids).await
    }

    // ── 挂起 / 恢复 ──

    pub async fn suspend(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo
            .get_mem(user_id, id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo.suspend_mem(user_id, id).await?;
        Ok(())
    }

    pub async fn unsuspend(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo
            .get_mem(user_id, id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo.unsuspend_mem(user_id, id).await?;
        Ok(())
    }

    // ── 批量操作 ──

    pub async fn batch_delete(&self, user_id: i32, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo
                .delete_mem(user_id, id)
                .await
                .map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    pub async fn batch_bury(&self, user_id: i32, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo
                .bury_mem(user_id, id)
                .await
                .map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    pub async fn batch_reset(&self, user_id: i32, ids: &[i32]) -> BatchResponse {
        let (_, errors) = batch_execute(ids.iter().copied(), |id| async move {
            self.repo
                .reset_mem(user_id, id)
                .await
                .map_err(|e| format!("{e}"))
        })
        .await;
        BatchResponse::from_results(errors, ids.len())
    }

    // ── CRUD ──

    pub async fn create(&self, user_id: i32, req: CreateMemRequest) -> Result<i32, ServiceError> {
        let cue_id = self.repo.create_chunk(user_id, &req.cue_content).await?;
        let target_id = self.repo.create_chunk(user_id, &req.target_content).await?;
        self.repo
            .create_mem(user_id, cue_id, target_id, &req.prerequisites)
            .await
    }

    pub async fn undo(&self, user_id: i32, id: i32, req: UndoRequest) -> Result<(), ServiceError> {
        self.repo
            .update_mem_fsrs(
                user_id,
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

    pub async fn edit(
        &self,
        user_id: i32,
        id: i32,
        req: EditMemRequest,
    ) -> Result<(), ServiceError> {
        let row = self
            .repo
            .get_mem(user_id, id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo
            .update_chunk(user_id, row.cue_chunk_id, &req.cue_content)
            .await?;
        self.repo
            .update_chunk(user_id, row.target_chunk_id, &req.target_content)
            .await?;
        Ok(())
    }

    pub async fn bury(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo.bury_mem(user_id, id).await
    }
    pub async fn unbury(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo.unbury_mem(user_id, id).await
    }
    pub async fn delete(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo.delete_mem(user_id, id).await
    }
    pub async fn reset(&self, user_id: i32, id: i32) -> Result<(), ServiceError> {
        self.repo.reset_mem(user_id, id).await
    }

    // ── 标签 ──

    pub async fn create_tag(&self, name: &str, user_id: i32) -> Result<TagInfo, ServiceError> {
        self.repo.create_tag(name, user_id).await
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), ServiceError> {
        self.repo.delete_tag(id).await?;
        Ok(())
    }

    pub async fn add_tag_to_mem(
        &self,
        user_id: i32,
        mem_id: i32,
        tag_id: i32,
    ) -> Result<(), ServiceError> {
        self.repo
            .get_mem(user_id, mem_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo.add_tag_to_mem(mem_id, tag_id).await?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), ServiceError> {
        self.repo.remove_tag_from_mem(mem_id, tag_id).await?;
        Ok(())
    }

    pub async fn set_mem_tags(
        &self,
        user_id: i32,
        mem_id: i32,
        tag_ids: &[i32],
    ) -> Result<(), ServiceError> {
        self.repo
            .get_mem(user_id, mem_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo.set_mem_tags(mem_id, tag_ids).await?;
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
    ) -> Result<(usize, Vec<String>), ServiceError> {
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
    ) -> Result<(usize, Vec<String>), ServiceError> {
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
    ) -> Result<(usize, Vec<String>), ServiceError> {
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

                    let cue_id = self.repo.create_chunk(user_id, cue).await?;
                    let target_id = self.repo.create_chunk(user_id, target).await?;
                    let mem_id = self
                        .repo
                        .create_mem(user_id, cue_id, target_id, &[])
                        .await?;

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
    ) -> Result<(), ServiceError> {
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
                .await?
                .into_iter()
                .find(|t| t.name == *name)
            {
                Some(t) => t,
                None => self.repo.create_tag(name, user_id).await?,
            };
            self.repo.add_tag_to_mem(mem_id, tag.id).await?;
        }
        Ok(())
    }

    /// 从 JSON 导入
    pub async fn import_json(
        &self,
        mems: &[JsonMemItem],
        user_id: i32,
        default_tags: &[String],
    ) -> Result<(usize, Vec<String>), ServiceError> {
        let mut count = 0usize;
        let mut errors = Vec::new();

        for (i, item) in mems.iter().enumerate() {
            let cue = item.cue.trim();
            let target = item.target.trim();

            if cue.is_empty() || target.is_empty() {
                errors.push(format!("项 {}: 线索或答案为空", i + 1));
                continue;
            }

            let cue_id = self.repo.create_chunk(user_id, cue).await?;
            let target_id = self.repo.create_chunk(user_id, target).await?;
            let mem_id = self
                .repo
                .create_mem(user_id, cue_id, target_id, &[])
                .await?;

            let tags_str = item.tags.join("; ");
            self.apply_tags_to_mem(mem_id, &tags_str, default_tags, user_id)
                .await?;

            count += 1;
        }

        Ok((count, errors))
    }

    // ── 助记 ──

    pub async fn set_mnemonic(
        &self,
        user_id: i32,
        mem_id: i32,
        content: &str,
    ) -> Result<(), ServiceError> {
        self.repo
            .get_mem(user_id, mem_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        self.repo.upsert_mnemonic(mem_id, content).await
    }
}

/// 对 review 候选做不放回加权采样，返回选中的 mem id（保持采样优先级顺序）。
fn sample_review_candidates(candidates: &[ReviewCandidate], quota: usize) -> Vec<i32> {
    if quota == 0 || candidates.is_empty() {
        return Vec::new();
    }
    let now = chrono::Utc::now();
    let weights: Vec<f64> = candidates
        .iter()
        .map(|c| selection::review_candidate_weight(c, now))
        .collect();
    let mut rng = rand::rng();
    selection::weighted_sample_indices(&weights, quota, &mut rng)
        .into_iter()
        .filter_map(|i| candidates.get(i).map(|c| c.id))
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::modules::mem::MemRepo;
    use crate::modules::mem::testing::{FakeRepo, NoopMaintenance, fake_candidate, fake_mem};
    use sqlx::SqlitePool;

    async fn setup_service() -> (MemService, MemRepo, SqlitePool, i32) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("PRAGMA foreign_keys = ON")
            .execute(&pool)
            .await
            .unwrap();
        let repo = MemRepo::new(Arc::new(pool.clone()));
        let service = MemService::new(
            Arc::new(repo.clone()),
            Arc::new(NoopMaintenance),
            Arc::new(crate::modules::mem::config::MemConfig::default()),
        );
        let cue = repo.create_chunk(1, "cue").await.unwrap();
        let target = repo.create_chunk(1, "target").await.unwrap();
        let id = repo.create_mem(1, cue, target, &[]).await.unwrap();
        (service, repo, pool, id)
    }

    async fn set_relearning(pool: &SqlitePool, id: i32, last_review_secs_ago: i64) {
        let last = (chrono::Utc::now() - chrono::Duration::seconds(last_review_secs_ago))
            .format(ISO_UTC_FORMAT)
            .to_string();
        sqlx::query(
            "UPDATE mem SET state='relearning', step_index=0, stability=5, difficulty=5, lapses=3, last_review_at=? WHERE id=?",
        )
        .bind(last)
        .bind(id)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn early_good_in_relearning_stays_in_relearning() {
        let (service, repo, pool, id) = setup_service().await;
        set_relearning(&pool, id, 5).await;

        let res = service.review(1, id, 3, 12.5).await.unwrap();
        assert_eq!(res.state, "relearning");

        let row = repo.get_mem(1, id).await.unwrap().unwrap();
        assert_eq!(row.state, "relearning");
        assert_eq!(row.step_index, Some(0));
        assert_eq!(row.stability, 5.0);
        assert_eq!(row.difficulty, 5.0);
        assert_eq!(row.lapses, 3, "提前 Good 未毕业，失败计数应保留");

        let due = chrono::DateTime::parse_from_rfc3339(&res.due_at)
            .unwrap()
            .with_timezone(&chrono::Utc);
        let remaining = (due - chrono::Utc::now()).num_seconds();
        assert!(
            (300..=600).contains(&remaining),
            "应等待剩余重学步进（约 595s），实际 {remaining}s"
        );
    }

    #[tokio::test]
    async fn relearning_good_after_full_step_graduates_with_min_one_day() {
        let (service, repo, pool, id) = setup_service().await;
        set_relearning(&pool, id, 610).await;

        let res = service.review(1, id, 3, 12.5).await.unwrap();
        assert_eq!(res.state, "review");

        let row = repo.get_mem(1, id).await.unwrap().unwrap();
        assert_eq!(row.state, "review");
        assert_eq!(row.lapses, 0, "真正毕业回 Review 才重置失败计数");
        let due = chrono::DateTime::parse_from_rfc3339(&res.due_at)
            .unwrap()
            .with_timezone(&chrono::Utc);
        let interval = (due - chrono::Utc::now()).num_seconds();
        assert!(
            interval >= 86400,
            "毕业间隔应至少 1 天，实际 {:.1}h",
            interval as f64 / 3600.0
        );
    }

    // ── 显式架构收益验证：只用 FakeRepo，不碰 SQLite ──

    #[tokio::test]
    async fn get_due_orchestrates_priority_through_fake_port() {
        let repo = Arc::new(FakeRepo::default());
        repo.learning.lock().unwrap().push(1);
        repo.due_reviews.lock().unwrap().push(fake_candidate(2));
        repo.new_cards.lock().unwrap().push(3);
        repo.mems.lock().unwrap().insert(1, fake_mem(1));
        repo.mems.lock().unwrap().insert(2, fake_mem(2));
        repo.mems.lock().unwrap().insert(3, fake_mem(3));

        let service = MemService::new(
            repo.clone(),
            Arc::new(NoopMaintenance),
            Arc::new(crate::modules::mem::config::MemConfig::default()),
        );
        let due = service.get_due(1, 3, &[], &[]).await.unwrap();

        assert_eq!(
            due.items.iter().map(|m| m.id).collect::<Vec<_>>(),
            vec![1, 2, 3],
            "应按 learning → due review → new 的顺序组队"
        );
        let calls = repo.set_state_calls.lock().unwrap();
        assert_eq!(calls.as_slice(), &[(3, "learning".into(), Some(0))]);
    }

    #[tokio::test]
    async fn review_missing_mem_returns_not_found_without_database() {
        let service = MemService::new(
            Arc::new(FakeRepo::default()),
            Arc::new(NoopMaintenance),
            Arc::new(crate::modules::mem::config::MemConfig::default()),
        );
        let err = service.review(1, 999, 3, 0.0).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }
}
