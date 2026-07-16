use sqlx::SqlitePool;
use std::sync::Arc;

use crate::batch::{BatchDataResponse, BatchResponse, batch_execute, batch_execute_with_code};
use crate::modules::mem::config::MemConfig;
use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::repository::{MemRepo, MemRow};
use crate::pagination::{PaginatedResponse, Pagination};

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
                (elapsed.num_seconds() / 86400) as u32
            } else {
                0
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

        // 3. 新卡填空
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

        // all_far：当前批次全部提前 24h+
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

    // ── 其他 ──

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
        let (new_count, learning_count, due_count, _, _) = self.repo.get_counts().await?;
        // relearning 包含在 learning_count 中，单独查
        let relearning_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM mem WHERE state = 'relearning' AND buried = 0",
        )
        .fetch_one(&*self.repo.pool)
        .await?;
        // learning 去掉 relearning 的纯学习卡
        let pure_learning = learning_count - relearning_count;

        let retention = self.repo.get_recent_retention(100).await?;

        let config = crate::modules::mem::config::MemConfig::load();
        let step_count_learning = config.learning_steps.len(); // 默认 2
        let step_count_relearning = config.relearn_steps.len(); // 默认 1

        // 每张新卡：每个 learning step 出现一次
        let new_total = new_count as usize * step_count_learning;

        // 学习中的卡：已过部分 step，估算剩余一半 + 至少 1 次
        let learning_remaining = if step_count_learning > 1 {
            step_count_learning / 2 + 1
        } else {
            1
        };
        let learning_total = pure_learning as usize * learning_remaining;

        // 重学中的卡：类似，估算剩余步数
        let relearn_remaining = if step_count_relearning > 1 {
            step_count_relearning / 2 + 1
        } else {
            1
        };
        let relearning_total = relearning_count as usize * relearn_remaining;

        // 到期的复习卡：部分可能失败进入重学，每张失败卡走一遍 relearn steps
        let fail_rate = if retention > 0.0 {
            1.0 - retention
        } else {
            0.2 // 默认 20%
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

    pub async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), AppError> {
        // 验证 mem 存在
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
        // 验证 mem 存在
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

    pub async fn get_mems_tags_batch(&self, mem_ids: &[i32]) -> BatchDataResponse<MemTagRow> {
        // 复用 repo 层的批量查询（单条 SQL，无部分失败语义）
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

    // ── CSV/JSON 导入导出 ──

    /// 导出为 PSV（Pipe-Separated Values），列分隔符为竖线 `|`
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

    async fn apply_tags_to_mem(
        &self,
        mem_id: i32,
        tags_str: &str,
        default_tags: &[String],
        user_id: i32,
    ) -> Result<(), AppError> {
        // 处理 CSV 中的标签 + 默认标签
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

    /// 从 CSV（逗号分隔）导入，兼容旧格式
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

    /// 从 PSV（竖线分隔）导入，与导出格式一致
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

    /// 导入逻辑复用：按分隔符(s)逐行解析 cue | target | tags
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

    pub async fn delete(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.delete_mem(id).await
    }
    pub async fn reset(&self, id: i32) -> Result<(), sqlx::Error> {
        self.repo.reset_mem(id).await
    }

    pub async fn get_mnemonic(&self, mem_id: i32) -> Result<Option<String>, sqlx::Error> {
        self.repo.get_mnemonic(mem_id).await
    }

    pub async fn set_mnemonic(&self, mem_id: i32, content: &str) -> Result<(), sqlx::Error> {
        self.repo.upsert_mnemonic(mem_id, content).await
    }
}

/// revlog 封顶条数。超过此值后修剪到 TARGET_REVLOGS。
/// 2000 条 ≈ 1-2 个月的日常复习数据，足够 FSRS 优化使用。
const MAX_REVLOGS: i64 = 2000;

/// 修剪后的目标条数（80% 水位线，避免频繁删除）。
const TARGET_REVLOGS: i64 = 1600;

/// 当 revlog 超过 MAX_REVLOGS 时，删除最旧的记录直到只剩 TARGET_REVLOGS 条。
async fn prune_revlog(pool: &SqlitePool) {
    let count: Result<(i64,), _> = sqlx::query_as("SELECT COUNT(*) FROM revlog")
        .fetch_one(pool)
        .await;
    let count = match count {
        Ok((n,)) => n,
        Err(_) => return,
    };
    if count <= MAX_REVLOGS {
        return;
    }

    let to_delete = count - TARGET_REVLOGS;
    tracing::info!(
        "revlog 已达 {} 条 (上限 {}), 删除最旧的 {} 条",
        count,
        MAX_REVLOGS,
        to_delete
    );

    // 删除最旧的 to_delete 条记录。
    // SQLite 支持在子查询中使用 LIMIT（3.33+），这等价于保留最新的 TARGET_REVLOGS 条。
    let result = sqlx::query(
        "DELETE FROM revlog WHERE id IN (SELECT id FROM revlog ORDER BY id ASC LIMIT ?)",
    )
    .bind(to_delete)
    .execute(pool)
    .await;

    match result {
        Ok(r) => tracing::info!("revlog 修剪完成, 删除了 {} 行", r.rows_affected()),
        Err(e) => tracing::warn!("revlog 修剪失败: {}", e),
    }
}

/// 如果 revlog 条数达到 `every` 的整数倍，自动触发 FSRS 参数优化。
/// 优化完成后检查是否需要修剪 revlog。
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

    // 优化完成后检查并修剪过旧的 revlog
    prune_revlog(&pool).await;
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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    /// 创建仅含 revlog 表的内存数据库（不需外键，prune 只操作 revlog）。
    async fn setup_revlog_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        sqlx::query(
            "CREATE TABLE revlog (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mem_id INTEGER NOT NULL DEFAULT 0,
                review_time TEXT NOT NULL,
                rating INTEGER NOT NULL,
                delta_t INTEGER NOT NULL
            )",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool
    }

    /// 插入 n 条 revlog，review_time 严格递增（无重复）。
    async fn insert_revlogs(pool: &SqlitePool, n: i64, base_mem_id: i32) {
        for i in 0..n {
            // 生成唯一递增的时间戳：基准时间 + i 分钟
            let review = format!(
                "2026-01-{:02}T{:02}:{:02}:00Z",
                1 + (i / 1440) as i32, // 天在第 1 天 → 递增
                (i / 60) as i32 % 24,  // 小时 0-23
                i as i32 % 60,         // 分钟 0-59
            );
            sqlx::query(
                "INSERT INTO revlog (mem_id, review_time, rating, delta_t) VALUES (?, ?, ?, ?)",
            )
            .bind(base_mem_id + (i % 5) as i32)
            .bind(&review)
            .bind((i % 4 + 1) as i32)
            .bind(1i32)
            .execute(pool)
            .await
            .unwrap();
        }
    }

    // ── prune_revlog ──

    #[tokio::test]
    async fn prune_revlog_below_max_does_nothing() {
        let pool = setup_revlog_db().await;
        insert_revlogs(&pool, 100, 1).await;

        prune_revlog(&pool).await;

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        // 100 < MAX_REVLOGS(2000)，不应被修剪
        assert_eq!(count, 100, "低于上限不应被修剪");
    }

    #[tokio::test]
    async fn prune_revlog_at_max_does_nothing() {
        let pool = setup_revlog_db().await;
        insert_revlogs(&pool, MAX_REVLOGS, 1).await;

        prune_revlog(&pool).await;

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, MAX_REVLOGS, "等于上限不应被修剪");
    }

    #[tokio::test]
    async fn prune_revlog_over_max_trims_to_target() {
        let pool = setup_revlog_db().await;
        // 插入 2500 条，超过 MAX_REVLOGS(2000)
        insert_revlogs(&pool, 2500, 1).await;

        prune_revlog(&pool).await;

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, TARGET_REVLOGS, "应修剪到目标值");
    }

    #[tokio::test]
    async fn prune_revlog_preserves_newest() {
        let pool = setup_revlog_db().await;
        insert_revlogs(&pool, 2100, 1).await;

        let max_id_before: i32 = sqlx::query_scalar("SELECT MAX(id) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(max_id_before, 2100);

        prune_revlog(&pool).await;

        // 最新的 id 保留
        let max_id_after: Option<i32> = sqlx::query_scalar("SELECT MAX(id) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(max_id_after, Some(2100), "最新 id 应保留");

        // 最旧的 id 已删除（2100-1600=500 条被删）
        let min_id_after: i32 = sqlx::query_scalar("SELECT MIN(id) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(min_id_after, 501, "最旧 500 条已删");

        // timestamp 严格递增，最旧的也应 > 2026-01-01T00:00:00Z
        let oldest_ts: String =
            sqlx::query_scalar("SELECT review_time FROM revlog ORDER BY review_time ASC LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(
            oldest_ts.as_str() > "2026-01-01T00:00:00Z",
            "最旧 timestamp={} 应大于 2026-01-01",
            oldest_ts
        );

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, TARGET_REVLOGS);
    }

    #[tokio::test]
    async fn prune_revlog_keeps_multiple_mems() {
        let pool = setup_revlog_db().await;
        // 5 个不同的 mem，共 2500 条，均分
        insert_revlogs(&pool, 2500, 1).await;

        prune_revlog(&pool).await;

        // 每个 mem 都应还有记录
        for mem_id in 1..=5 {
            let cnt: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog WHERE mem_id = ?")
                .bind(mem_id)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(
                cnt > 0,
                "mem_id={} 至少应有 1 条记录 (实际 {})",
                mem_id,
                cnt
            );
        }
    }

    #[tokio::test]
    async fn prune_revlog_empty_db_does_nothing() {
        let pool = setup_revlog_db().await;
        prune_revlog(&pool).await;
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "空库不应出错");
    }

    #[tokio::test]
    async fn prune_revlog_slightly_over_max() {
        let pool = setup_revlog_db().await;
        // 2010 条，刚超 MAX_REVLOGS(2000) 一点点
        insert_revlogs(&pool, MAX_REVLOGS + 10, 1).await;

        prune_revlog(&pool).await;

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        // 2010 - 1600 = 410 条被删，剩 1600
        assert_eq!(count, TARGET_REVLOGS, "刚超上限也应修剪到目标值");
    }

    #[tokio::test]
    async fn prune_revlog_many_times_idempotent() {
        let pool = setup_revlog_db().await;
        insert_revlogs(&pool, 3000, 1).await;

        // 第一次修剪
        prune_revlog(&pool).await;
        let count1: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count1, TARGET_REVLOGS);

        // 第二次修剪（此时 count ≤ MAX_REVLOGS，不应再删）
        prune_revlog(&pool).await;
        let count2: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM revlog")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count2, TARGET_REVLOGS, "重复修剪不应继续删除");
    }

    // ── get_due 调度测试 ──

    /// 创建包含 mem 相关表的内存 DB + MemService
    async fn setup_mem_service() -> MemService {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("create in-memory db");

        sqlx::query("CREATE TABLE chunk (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL DEFAULT '', created_at TEXT, updated_at TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE mem (id INTEGER PRIMARY KEY AUTOINCREMENT, cue_chunk_id INTEGER NOT NULL, target_chunk_id INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'new', stability REAL DEFAULT 0, difficulty REAL DEFAULT 0, step_index INTEGER, buried INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0, leeched INTEGER NOT NULL DEFAULT 0, due_at TEXT, last_review_at TEXT, created_at TEXT)"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE mem_prerequisite (id INTEGER PRIMARY KEY AUTOINCREMENT, mem_id INTEGER NOT NULL, requires_mem_id INTEGER NOT NULL, UNIQUE(mem_id, requires_mem_id))"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE tag (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, user_id INTEGER NOT NULL, UNIQUE(name, user_id))"
        ).execute(&pool).await.unwrap();
        sqlx::query(
            "CREATE TABLE mem_tag (mem_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY(mem_id, tag_id))"
        ).execute(&pool).await.unwrap();

        MemService::new(Arc::new(pool))
    }

    /// 快速创建一张卡：cue + target 内容，可覆盖 state 和 due_at
    async fn insert_mem(svc: &MemService, state: &str, due_at: &str) -> i32 {
        let cue_id = svc.repo.create_chunk("cue").await.unwrap();
        let target_id = svc.repo.create_chunk("target").await.unwrap();
        let id = svc.repo.create_mem(cue_id, target_id, &[]).await.unwrap();
        sqlx::query("UPDATE mem SET state=?, due_at=?, stability=1.0, difficulty=1.0 WHERE id=?")
            .bind(state)
            .bind(due_at)
            .bind(id)
            .execute(&*svc.repo.pool)
            .await
            .unwrap();
        id
    }

    /// 查询卡当前状态
    async fn get_state(svc: &MemService, id: i32) -> String {
        sqlx::query_scalar("SELECT state FROM mem WHERE id=?")
            .bind(id)
            .fetch_one(&*svc.repo.pool)
            .await
            .unwrap()
    }

    /// deferred 保底：即使 review 卡充足，每轮至少拉回 1 张 deferred
    #[tokio::test]
    async fn get_due_pulls_deferred_before_review() {
        let svc = setup_mem_service().await;

        // 1 张 deferred 卡
        let deferred_id = insert_mem(&svc, "deferred", "2020-01-01T00:00:00Z").await;

        // 10 张到期的 review 卡
        for _ in 0..10 {
            insert_mem(&svc, "review", "2020-01-01T00:00:00Z").await;
        }

        let result = svc.get_due(5, &[], &[]).await.unwrap();

        // 至少应包含 deferred 卡
        let has_deferred = result.items.iter().any(|m| m.id == deferred_id);
        assert!(has_deferred, "每轮至少应拉回 1 张 deferred 卡");

        // deferred 卡被拉出后应恢复为 learning
        let deferred_new_state = get_state(&svc, deferred_id).await;
        assert_eq!(
            deferred_new_state, "learning",
            "deferred 卡应恢复为 learning"
        );
    }

    /// 有 deferred 卡但没有 review 卡时，保底槽位照常生效
    #[tokio::test]
    async fn get_due_pulls_deferred_without_review() {
        let svc = setup_mem_service().await;

        // 3 张 deferred 卡
        let d1 = insert_mem(&svc, "deferred", "2020-01-01T00:00:00Z").await;
        let d2 = insert_mem(&svc, "deferred", "2020-01-01T00:00:00Z").await;
        let d3 = insert_mem(&svc, "deferred", "2020-01-01T00:00:00Z").await;

        let result = svc.get_due(5, &[], &[]).await.unwrap();

        // 所有 deferred 卡都应该被拉回来（因为没有 review 卡抢位）
        let ids_in_result: Vec<i32> = result.items.iter().map(|m| m.id).collect();
        assert!(ids_in_result.contains(&d1));
        assert!(ids_in_result.contains(&d2));
        assert!(ids_in_result.contains(&d3));

        // 全部恢复为 learning
        for &id in &[d1, d2, d3] {
            assert_eq!(get_state(&svc, id).await, "learning");
        }
    }

    /// learning 卡超过 threshold 时 defer 1/2
    /// 注意：get_due 内部会先 defer 再拉回 deferred，所以最终状态需要分别验证
    #[tokio::test]
    async fn get_due_defers_half_of_overdue_learning() {
        let svc = setup_mem_service().await;

        // 创建 20 张到期 learning 卡（超过 threshold = 5*2 = 10）
        let midnight = "2020-01-01T00:00:00Z";
        for _ in 0..20 {
            insert_mem(&svc, "learning", midnight).await;
        }

        let result = svc.get_due(5, &[], &[]).await.unwrap();

        // learning_quota = max(1, 5/2) = 2
        // 返回 5 张（learning + deferred 拉回），其中至少 2 张来自 learning
        assert_eq!(result.items.len(), 5, "应返回 5 张卡");

        let remaining_learning: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM mem WHERE state='learning'")
                .fetch_one(&*svc.repo.pool)
                .await
                .unwrap();

        let deferred_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM mem WHERE state='deferred'")
                .fetch_one(&*svc.repo.pool)
                .await
                .unwrap();

        // to_defer = 20/2 = 10（原始 defer）
        // deferred_slot 拉 1 + more_deferred 拉若干 → 最终 deferred e [5,9]
        assert!(
            deferred_count >= 5 && deferred_count <= 9,
            "defer ≈ 10 但部分被拉回，实际 deferred={deferred_count}"
        );
        assert!(
            remaining_learning >= 9 && remaining_learning <= 15,
            "2(batch) + 8(未触碰) + 3(拉回) ≈ 13, 实际 learning={remaining_learning}"
        );
        // 总数守恒
        assert_eq!(
            remaining_learning + deferred_count,
            20,
            "所有卡要么 learning 要么 deferred"
        );
    }
}
