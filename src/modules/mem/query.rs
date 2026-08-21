use std::sync::Arc;

use async_trait::async_trait;

use crate::modules::mem::dto::*;
use crate::modules::mem::fsrs;
use crate::modules::mem::model::*;
use crate::modules::mem::port::MemRepository;
use crate::shared::batch::BatchDataResponse;
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};
use crate::shared::search::{SearchHit, SearchPort, clip, merge_snippets};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：`MemQueryService` 只暴露不修改状态的读方法。
/// 写操作（包括 `get_due` 因其内部修改新卡状态）保留在 `MemService` 中。
#[derive(Clone)]
pub struct MemQueryService {
    repo: Arc<dyn MemRepository>,
    /// 记忆配置（FSRS 参数），调度时显式传入
    mem_config: Arc<crate::modules::mem::config::MemConfig>,
}

impl MemQueryService {
    pub fn new(
        repo: Arc<dyn MemRepository>,
        mem_config: Arc<crate::modules::mem::config::MemConfig>,
    ) -> Self {
        Self { repo, mem_config }
    }

    // ── 管理列表 ──

    pub async fn get_all(
        &self,
        user_id: i32,
        query: &MemQuery,
    ) -> Result<PaginatedResponse<MemWithChunks>, ServiceError> {
        let pagination = Pagination {
            page: query.page.unwrap_or(1),
            page_size: query.page_size.unwrap_or(50),
        };
        let (page, page_size) = pagination.clamp();
        let offset = (page - 1) * page_size;
        let ids = self
            .repo
            .get_all_mems(user_id, page_size, offset, query)
            .await?;
        let items = self.build_items(user_id, &ids).await?;
        let total = self.repo.count_all_mems(user_id, query).await?;
        let pagination_ref = &pagination;
        Ok(PaginatedResponse::new(items, total, pagination_ref))
    }

    // ── 统计 ──

    pub async fn get_counts(&self, user_id: i32) -> Result<MemCounts, ServiceError> {
        let (new_count, learning_count, due_count, buried_count, suspended_count) =
            self.repo.get_counts(user_id).await?;
        Ok(MemCounts {
            new: new_count as usize,
            learning: learning_count as usize,
            due: due_count as usize,
            buried: buried_count as usize,
            suspended: suspended_count as usize,
        })
    }

    pub async fn get_session_estimate(
        &self,
        user_id: i32,
        config: &crate::modules::mem::config::MemConfig,
        tag_ids: &[i32],
        exclude_tag_ids: &[i32],
    ) -> Result<SessionEstimate, ServiceError> {
        let stats = self
            .repo
            .get_session_stats(user_id, tag_ids, exclude_tag_ids)
            .await?;
        let p = rating_probs(&stats.rating_counts);

        let learning_steps = config.learning_steps.len();
        let relearn_steps = config.relearn_steps.len();

        // 每个步进位置的期望查看次数（Markov 模型：Again 回到 step 0，Hard 停留，Good/Easy 前进）
        let learning_expect = expected_step_presentations(learning_steps, &p);
        let relearn_expect = expected_step_presentations(relearn_steps, &p);

        let new_total = stats.new_ready as f64 * step_expect_at(&learning_expect, 0);
        let learning_total = step_bucket_total(&stats.learning_steps, &learning_expect);
        let relearning_total = step_bucket_total(&stats.relearning_steps, &relearn_expect);

        // 到期复习卡：至少看一次；Again 后转入重学序列（Hard 不留在本次会话）
        let again_rate = *p.first().unwrap_or(&0.0);
        let review_total =
            stats.due_ready as f64 * (1.0 + again_rate * step_expect_at(&relearn_expect, 0));

        let total_estimate = (new_total + learning_total + relearning_total + review_total)
            .round()
            .max((stats.new_ready + stats.due_ready) as f64) as usize;

        let due_count = (stats.new_ready
            + stats.learning_steps.iter().sum::<i64>()
            + stats.relearning_steps.iter().sum::<i64>()
            + stats.due_ready) as usize;

        let rated_total = stats.rating_counts.iter().sum::<i64>();
        let passed = stats.rating_counts.get(2).copied().unwrap_or(0)
            + stats.rating_counts.get(3).copied().unwrap_or(0);
        let retention = if rated_total > 0 {
            passed as f64 / rated_total as f64
        } else {
            0.0
        };

        Ok(SessionEstimate {
            due_count,
            retention,
            total_estimate,
            avg_seconds: stats.avg_duration_secs,
        })
    }

    // ── 预览 ──

    pub async fn preview(&self, user_id: i32, id: i32) -> Result<[f64; 4], ServiceError> {
        let row = self
            .repo
            .get_mem(user_id, id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("记忆项不存在".into()))?;
        let state: CardState = row.state.parse().unwrap_or(CardState::New);
        let days_elapsed = days_elapsed_since(&row.last_review_at);
        let elapsed_secs = elapsed_secs_since(&row.last_review_at);
        let config = fsrs::SchedulerConfig {
            learning_steps: self.mem_config.learning_steps.clone(),
            relearn_steps: self.mem_config.relearn_steps.clone(),
            graduating_interval_secs: self.mem_config.graduating_interval_secs,
            desired_retention: self.mem_config.desired_retention,
            fsrs_params: self.mem_config.fsrs_params.clone(),
        };
        fsrs::preview(
            row.stability,
            row.difficulty,
            state,
            row.step_index.map(|i| i as usize),
            days_elapsed,
            elapsed_secs,
            &config,
        )
        .map_err(ServiceError::Internal)
    }

    // ── 标签查询 ──

    pub async fn list_tags(&self, user_id: i32) -> Result<Vec<TagInfo>, ServiceError> {
        self.repo.list_tags(user_id).await
    }

    pub async fn search_tags(&self, user_id: i32, q: &str) -> Result<Vec<TagInfo>, ServiceError> {
        self.repo.search_tags(user_id, q).await
    }

    pub async fn get_mem_tags(
        &self,
        user_id: i32,
        mem_id: i32,
    ) -> Result<Vec<TagInfo>, ServiceError> {
        // 先通过 get_mem 校验所有权（共享数据可见），再返回标签
        self.repo.get_mem(user_id, mem_id).await?;
        self.repo.get_mem_tags(mem_id).await
    }

    pub async fn get_mems_tags_batch(
        &self,
        user_id: i32,
        mem_ids: &[i32],
    ) -> BatchDataResponse<MemTagRow> {
        match self.repo.get_mems_tags_batch(user_id, mem_ids).await {
            Ok(items) => BatchDataResponse::all_ok(items),
            Err(e) => BatchDataResponse::from_results(
                vec![],
                vec![crate::shared::batch::BatchErrorDetail {
                    index: 0,
                    code: "Internal Server Error".into(),
                    message: format!("数据库查询失败: {e}"),
                }],
                mem_ids.len(),
            ),
        }
    }

    // ── CSV/PSV 导出 ──

    pub async fn export_csv(&self, user_id: i32, tag_ids: &[i32]) -> Result<String, ServiceError> {
        let rows = self.repo.export_all_mems(user_id, tag_ids).await?;
        let mut wtr = csv::WriterBuilder::new()
            .delimiter(b'|')
            .from_writer(Vec::new());
        wtr.write_record(["cue", "target", "tags"])
            .map_err(|e| ServiceError::Internal(e.to_string()))?;

        for (cue, target, tags) in &rows {
            wtr.write_record([cue, target, tags])
                .map_err(|e| ServiceError::Internal(e.to_string()))?;
        }

        wtr.flush()
            .map_err(|e| ServiceError::Internal(e.to_string()))?;
        let data = wtr
            .into_inner()
            .map_err(|e| ServiceError::Internal(e.to_string()))?;
        String::from_utf8(data).map_err(|e| ServiceError::Internal(e.to_string()))
    }

    // ── 助记 ──

    pub async fn get_mnemonic(
        &self,
        user_id: i32,
        mem_id: i32,
    ) -> Result<Option<String>, ServiceError> {
        self.repo.get_mem(user_id, mem_id).await?;
        self.repo.get_mnemonic(mem_id).await
    }

    // ── upcoming ──

    pub async fn upcoming_counts(&self, user_id: i32) -> Result<serde_json::Value, ServiceError> {
        let h8 = self.repo.count_upcoming_within_hours(user_id, 8).await?;
        let h24 = self.repo.count_upcoming_within_hours(user_id, 24).await?;
        Ok(serde_json::json!({"within_8h": h8, "within_24h": h24}))
    }

    // ── 内部辅助 ──

    async fn build_items(
        &self,
        user_id: i32,
        ids: &[i32],
    ) -> Result<Vec<MemWithChunks>, ServiceError> {
        self.repo.get_mems_with_chunks(user_id, ids).await
    }
}

#[async_trait]
impl SearchPort for MemQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(vec![]);
        }
        let cap = limit.clamp(1, 20);
        let like = crate::shared::db_query::like_contains(kw);
        let rows = self
            .repo
            .search_hits(user_id, &like, cap)
            .await
            .map_err(|e| ServiceError::Internal(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|(id, cue, target)| SearchHit {
                kind: "mem".into(),
                id,
                title: clip(&cue, 60),
                snippet: merge_snippets(&cue, &target, kw),
                url: format!("/memory/manage?id={id}"),
            })
            .collect())
    }
}

// ── 会话预估纯函数（Markov 步进模型） ──

/// 最近评分分布 → [Again, Hard, Good, Easy] 概率。
/// 用贝叶斯平滑：无历史时回落到常见 FSRS 先验，小样本不全信。
/// 先验伪计数 [Again=1, Hard=1, Good=7, Easy=1]（总强度 10）。
fn rating_probs(counts: &[i64; 4]) -> [f64; 4] {
    const PRIOR: [i64; 4] = [1, 1, 7, 1];
    let mut smoothed = [0_i64; 4];
    for ((slot, count), prior) in smoothed.iter_mut().zip(counts.iter()).zip(PRIOR.iter()) {
        *slot = (*count).max(0) + *prior;
    }
    let total = smoothed.iter().sum::<i64>() as f64;
    let mut probs = [0.0; 4];
    for (slot, count) in probs.iter_mut().zip(smoothed.iter()) {
        *slot = *count as f64 / total;
    }
    probs
}

/// 单卡单步进状态最大预估呈现次数：防止极端 Again 历史把预估放大到无意义
const MAX_EXPECTED_PER_STEP: f64 = 20.0;

/// 期望步进呈现次数。
///
/// 状态转移：Again → step 0；Hard → 留在当前 step；Good/Easy → step+1（末步毕业）。
/// 对每个 step s 求解 E[s] = 1 + p0·E[0] + p1·E[s] + (p2+p3)·E[s+1]。
fn expected_step_presentations(steps_len: usize, p: &[f64; 4]) -> Vec<f64> {
    if steps_len == 0 {
        return Vec::new();
    }
    let again = *p.first().unwrap_or(&0.0);
    let advance = p.get(2).copied().unwrap_or(0.0) + p.get(3).copied().unwrap_or(0.0);
    let stay = p.get(1).copied().unwrap_or(0.0);
    // E[s] = A[s] + B[s] * E[0]，从末步倒推（E[steps_len] = 0）
    let mut a = vec![0.0; steps_len + 1];
    let mut b = vec![0.0; steps_len + 1];
    let denom = (1.0 - stay).max(1e-6);
    for s in (0..steps_len).rev() {
        let a_next = a.get(s + 1).copied().unwrap_or(0.0);
        let b_next = b.get(s + 1).copied().unwrap_or(0.0);
        if let Some(slot) = a.get_mut(s) {
            *slot = (1.0 + advance * a_next) / denom;
        }
        if let Some(slot) = b.get_mut(s) {
            *slot = (again + advance * b_next) / denom;
        }
    }
    // E[0] = A[0] + B[0]·E[0]
    let a0 = a.first().copied().unwrap_or(0.0);
    let b0 = b.first().copied().unwrap_or(0.0);
    let e0 = if (1.0 - b0).abs() > 1e-9 {
        a0 / (1.0 - b0)
    } else {
        // 状态机退化（如 Again 概率极端高）：退化为步数上界
        steps_len as f64 * 2.0
    };
    (0..steps_len)
        .map(|s| a.get(s).copied().unwrap_or(0.0) + b.get(s).copied().unwrap_or(0.0) * e0)
        .map(|v| v.clamp(1.0, MAX_EXPECTED_PER_STEP))
        .collect()
}

fn step_expect_at(expect: &[f64], step: usize) -> f64 {
    if expect.is_empty() {
        return 0.0;
    }
    expect
        .get(step)
        .copied()
        .or_else(|| expect.last().copied())
        .unwrap_or(0.0)
}

/// Σ 每个 step 桶的卡数 × 该 step 的期望呈现次数
fn step_bucket_total(buckets: &[i64], expect: &[f64]) -> f64 {
    buckets
        .iter()
        .enumerate()
        .map(|(step, count)| *count as f64 * step_expect_at(expect, step))
        .sum()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use crate::modules::mem::testing::FakeRepo;

    #[tokio::test]
    async fn preview_missing_mem_returns_not_found_through_fake_port() {
        let svc = MemQueryService::new(
            Arc::new(FakeRepo::default()),
            Arc::new(crate::modules::mem::config::MemConfig::default()),
        );
        let err = svc.preview(1, 1).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[test]
    fn rating_probs_uses_smooth_prior_when_no_history() {
        let p = rating_probs(&[0, 0, 0, 0]);
        assert!((p[0] - 0.1).abs() < 1e-12);
        assert!((p[1] - 0.1).abs() < 1e-12);
        assert!((p[2] - 0.7).abs() < 1e-12);
        assert!((p[3] - 0.1).abs() < 1e-12);
    }

    #[test]
    fn rating_probs_smooths_small_failure_samples() {
        let p = rating_probs(&[3, 0, 0, 0]);
        assert!(p[2] > 0.5, "3 条 Again 不应把 Good/Easy 压到零: {p:?}");
        assert!(p[0] > p[1]);
    }

    #[test]
    fn step_expectations_match_markov_model() {
        // 先验 p = [0.1, 0.1, 0.7, 0.1]：两步学习步进
        let p = [0.1, 0.1, 0.7, 0.1];
        let e = expected_step_presentations(2, &p);
        assert!((e[0] - 2.65625).abs() < 1e-9);
        assert!((e[1] - 1.40625).abs() < 1e-9);

        // 单步重学：E[0] = 1 / (Good+Easy) = 1.25
        let e = expected_step_presentations(1, &p);
        assert!((e[0] - 1.25).abs() < 1e-9);

        // 全 Again 的极端历史也有上限，不会把预估放大到无意义
        let e = expected_step_presentations(2, &rating_probs(&[200, 0, 0, 0]));
        assert!(e.iter().all(|v| *v <= MAX_EXPECTED_PER_STEP));
    }
}
