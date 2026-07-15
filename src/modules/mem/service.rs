use sqlx::SqlitePool;
use std::sync::Arc;

use crate::modules::mem::config::MemConfig;
use crate::modules::mem::fsrs::{self, ReviewOutcome};
use crate::modules::mem::model::*;
use crate::modules::mem::repository::{MemRepo, MemRow};
use crate::batch::{batch_execute, batch_execute_with_code, BatchDataResponse, BatchResponse};
use crate::pagination::{Pagination, PaginatedResponse};

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

    pub async fn get_due(&self, max_learning: i64, tag_ids: &[i32], exclude_tag_ids: &[i32]) -> Result<DueResponse, sqlx::Error> {
        let learning_quota = std::cmp::max(1, max_learning / 2) as usize;
        let threshold = (max_learning * 2) as usize;

        // 统计到期 learning 卡总数
        let due_learning_count = self.repo.get_due_learning_count(tag_ids, exclude_tag_ids).await? as usize;

        let mut ids: Vec<i32> = Vec::new();
        let mut deferred_extra = false;

        // 如果太多 → 随机 defer 1/3
        if due_learning_count > threshold {
            let to_defer = due_learning_count / 3;
            // 取 learning_quota 张作为本批，其余随机 defer
            let all_learning = self.repo.get_learning_mems(due_learning_count as i64, tag_ids, exclude_tag_ids).await?;
            let for_batch: Vec<i32> = all_learning.iter().take(learning_quota).copied().collect();
            let extra: Vec<i32> = all_learning.iter().skip(learning_quota).copied().collect();
            // extra 中随机选 to_defer 张 defer（在 await 前完成所有 RNG 操作）
            use rand::seq::IteratorRandom;
            use rand::seq::IndexedRandom;
            let to_defer_ids: Vec<i32> = extra.iter().copied().sample(&mut rand::rng(), to_defer);
            self.repo.defer_learning_cards(&to_defer_ids).await?;
            ids = for_batch;
            deferred_extra = true;
        } else {
            ids = self.repo.get_learning_mems(learning_quota as i64, tag_ids, exclude_tag_ids).await?;
        }

        // 取 review
        let review_quota = (max_learning as usize).saturating_sub(ids.len());
        if review_quota > 0 {
            let due = self.repo.get_due_reviews(review_quota as i64, tag_ids, exclude_tag_ids).await?;
            ids.extend(due);
        }

        // review 不足 → 从 deferred 拉回来
        let needed = (max_learning as usize).saturating_sub(ids.len());
        if needed > 0 {
            let deferred = self.repo.get_deferred_learning(needed as i64, tag_ids).await?;
            for id in &deferred {
                self.repo.set_state(*id, "learning", Some(0)).await?;
            }
            ids.extend(deferred);
        }

        // 还不够 → 新卡
        let needed = (max_learning as usize).saturating_sub(ids.len());
        if needed > 0 {
            let new_cards = self.repo.get_new_cards(needed as i64, tag_ids, exclude_tag_ids).await?;
            for id in &new_cards {
                self.repo.set_state(*id, "learning", Some(0)).await?;
            }
            ids.extend(new_cards);
        }

        // 还不够 → upcoming
        let needed = (max_learning as usize).saturating_sub(ids.len());
        if needed > 0 {
            let upcoming = self.repo.get_upcoming_reviews(needed as i64, tag_ids).await?;
            ids.extend(upcoming);
        }

        if ids.is_empty()
            && let Ok(Some(id)) = self.repo.get_next_mem().await {
                ids.push(id);
            }

        let items = self.build_items(&ids).await;
        let has_more = deferred_extra || ids.len() >= max_learning as usize;
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
        let cumulative_step_days = if state.has_steps() || state == CardState::New {
            days_elapsed
        } else {
            days_elapsed
        };
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
        items
    }

    pub async fn get_all(&self, query: &MemQuery) -> Result<PaginatedResponse<MemWithChunks>, sqlx::Error> {
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
            "SELECT COUNT(*) FROM mem WHERE state = 'relearning' AND buried = 0"
        )
        .fetch_one(&*self.repo.pool)
        .await?;
        // learning 去掉 relearning 的纯学习卡
        let pure_learning = learning_count - relearning_count;

        let retention = self.repo.get_recent_retention(100).await?;

        let config = crate::modules::mem::config::MemConfig::load();
        let step_count_learning = config.learning_steps.len();  // 默认 2
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
        self.repo.create_tag(name, user_id).await.map_err(AppError::Db)
    }

    pub async fn delete_tag(&self, id: i32) -> Result<(), AppError> {
        self.repo.delete_tag(id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, AppError> {
        self.repo.list_tags(user_id).await.map_err(AppError::Db)
    }

    pub async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, AppError> {
        self.repo.search_tags(user_id, q).await.map_err(AppError::Db)
    }

    pub async fn get_mem_tags(&self, mem_id: i32) -> Result<Vec<TagInfo>, AppError> {
        self.repo.get_mem_tags(mem_id).await.map_err(AppError::Db)
    }

    pub async fn add_tag_to_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), AppError> {
        // 验证 mem 存在
        self.repo.get_mem(mem_id).await?.ok_or(AppError::NotFound)?;
        self.repo.add_tag_to_mem(mem_id, tag_id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn remove_tag_from_mem(&self, mem_id: i32, tag_id: i32) -> Result<(), AppError> {
        self.repo.remove_tag_from_mem(mem_id, tag_id).await.map_err(AppError::Db)?;
        Ok(())
    }

    pub async fn set_mem_tags(&self, mem_id: i32, tag_ids: &[i32]) -> Result<(), AppError> {
        // 验证 mem 存在
        self.repo.get_mem(mem_id).await?.ok_or(AppError::NotFound)?;
        self.repo.set_mem_tags(mem_id, tag_ids).await.map_err(AppError::Db)?;
        Ok(())
    }

    // ── 批量标签 ──

    pub async fn batch_add_tag_to_mems(&self, mem_ids: &[i32], tag_id: i32) -> BatchResponse {
        let (_, errors) = batch_execute_with_code(
            mem_ids.iter().copied(),
            |mem_id| async move {
                self.repo
                    .add_tag_to_mem(mem_id, tag_id)
                    .await
                    .map_err(|e| ("DB_ERROR", format!("{e}")))
            },
        )
        .await;
        BatchResponse::from_results(errors, mem_ids.len())
    }

    pub async fn batch_remove_tag_from_mems(&self, mem_ids: &[i32], tag_id: i32) -> BatchResponse {
        let (_, errors) = batch_execute_with_code(
            mem_ids.iter().copied(),
            |mem_id| async move {
                self.repo
                    .remove_tag_from_mem(mem_id, tag_id)
                    .await
                    .map_err(|e| ("DB_ERROR", format!("{e}")))
            },
        )
        .await;
        BatchResponse::from_results(errors, mem_ids.len())
    }

    pub async fn batch_set_tags_for_mems(&self, mem_ids: &[i32], tag_ids: &[i32]) -> BatchResponse {
        let tag_ids = tag_ids.to_vec();
        let (_, errors) = batch_execute_with_code(
            mem_ids.iter().copied(),
            |mem_id| {
                let tag_ids = tag_ids.clone();
                async move {
                    self.repo
                        .set_mem_tags(mem_id, &tag_ids)
                        .await
                        .map_err(|e| ("DB_ERROR", format!("{e}")))
                }
            },
        )
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
        let rows = self.repo.export_all_mems(tag_ids).await.map_err(AppError::Db)?;
        let mut wtr = csv::WriterBuilder::new()
            .delimiter(b'|')
            .from_writer(Vec::new());
        wtr.write_record(["cue", "target", "tags"]).map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;

        for (cue, target, tags) in &rows {
            wtr.write_record([cue, target, tags]).map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        }

        wtr.flush().map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        let data = wtr.into_inner().map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))?;
        String::from_utf8(data).map_err(|e| AppError::Db(sqlx::Error::Protocol(e.to_string())))
    }

    async fn apply_tags_to_mem(&self, mem_id: i32, tags_str: &str, default_tags: &[String], user_id: i32) -> Result<(), AppError> {
        // 处理 CSV 中的标签 + 默认标签
        let mut all_names: Vec<String> = tags_str.split([';', ',']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
        for dt in default_tags {
            if !all_names.contains(dt) {
                all_names.push(dt.clone());
            }
        }
        for name in &all_names {
            let tag = match self.repo.search_tags(user_id, name).await.map_err(AppError::Db)?.into_iter().find(|t| t.name == *name) {
                Some(t) => t,
                None => self.repo.create_tag(name, user_id).await.map_err(AppError::Db)?,
            };
            self.repo.add_tag_to_mem(mem_id, tag.id).await.map_err(AppError::Db)?;
        }
        Ok(())
    }

    /// 从 CSV（逗号分隔）导入，兼容旧格式
    pub async fn import_csv(&self, csv_data: &str, user_id: i32, default_tags: &[String]) -> Result<(usize, Vec<String>), AppError> {
        let mut reader = csv::ReaderBuilder::new()
            .has_headers(true)
            .flexible(true)
            .from_reader(csv_data.as_bytes());
        self.import_records(&mut reader, user_id, default_tags).await
    }

    /// 从 PSV（竖线分隔）导入，与导出格式一致
    pub async fn import_psv(&self, psv_data: &str, user_id: i32, default_tags: &[String]) -> Result<(usize, Vec<String>), AppError> {
        let mut reader = csv::ReaderBuilder::new()
            .delimiter(b'|')
            .has_headers(true)
            .flexible(true)
            .from_reader(psv_data.as_bytes());
        self.import_records(&mut reader, user_id, default_tags).await
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
                    let mem_id = self.repo.create_mem(cue_id, target_id, &[]).await.map_err(AppError::Db)?;

                    self.apply_tags_to_mem(mem_id, tags_str, default_tags, user_id).await?;

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
            let mem_id = self.repo.create_mem(cue_id, target_id, &[]).await.map_err(AppError::Db)?;

            let tags_str = item.tags.join("; ");
            self.apply_tags_to_mem(mem_id, &tags_str, default_tags, user_id).await?;

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
