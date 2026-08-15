//! FSRS 参数优化器。
//!
//! 从 revlog 读取复习记录，调用 fsrs crate 的 `compute_parameters`，
//! 将优化后的参数写回 MemConfig。

use std::sync::Arc;

use fsrs::{FSRSItem, FSRSReview};
use sqlx::{FromRow, SqlitePool};

use super::config::MemConfig;

/// revlog 行（INTEGER 列用 i32 覆盖以直接进入 FSRSReview）
#[derive(FromRow)]
struct RevlogRow {
    mem_id: i32,
    delta_t: i32,
    rating: i32,
}

/// 从 DB 读取所有复习记录，分组为 FSRSItem 列表
async fn load_fsrs_items(pool: &SqlitePool) -> Result<Vec<FSRSItem>, sqlx::Error> {
    // 按 mem_id 分组读取
    let rows: Vec<RevlogRow> = sqlx::query_as!(
        RevlogRow,
        r#"SELECT mem_id AS "mem_id: i32", delta_t AS "delta_t: i32", rating AS "rating: i32"
           FROM revlog
           ORDER BY mem_id, review_time ASC"#
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        return Ok(Vec::new());
    }

    let mut items: Vec<FSRSItem> = Vec::new();
    let Some(first_row) = rows.first() else {
        return Ok(Vec::new());
    };
    let mut current_id = first_row.mem_id;
    let mut reviews: Vec<FSRSReview> = Vec::new();

    for row in rows {
        if row.mem_id != current_id {
            if !reviews.is_empty() {
                items.push(FSRSItem {
                    reviews: std::mem::take(&mut reviews),
                });
            }
            current_id = row.mem_id;
        }
        reviews.push(FSRSReview {
            rating: row.rating as u32,
            delta_t: row.delta_t as u32,
        });
    }
    if !reviews.is_empty() {
        items.push(FSRSItem { reviews });
    }

    Ok(items)
}

/// 执行 FSRS 参数优化。
///
/// 返回优化后的 19 个参数。如果数据不足则返回 Ok(None)。
pub async fn optimize_fsrs_params(
    pool: &Arc<SqlitePool>,
    config: &MemConfig,
) -> Result<Option<Vec<f32>>, String> {
    let items = load_fsrs_items(pool)
        .await
        .map_err(|e| format!("读取复习记录失败: {e}"))?;

    if items.is_empty() {
        return Ok(None);
    }

    let total_reviews: usize = items.iter().map(|i| i.reviews.len()).sum();
    if total_reviews < 10 {
        return Ok(None);
    }

    let input = fsrs::ComputeParametersInput {
        train_set: items,
        enable_short_term: true,
        num_relearning_steps: Some(config.relearn_steps.len()),
        ..Default::default()
    };

    let params = fsrs::compute_parameters(input).map_err(|e| format!("优化失败: {e}"))?;

    tracing::info!(
        "FSRS 参数优化完成: 共 {} 条复习记录, 得到 {} 个参数",
        total_reviews,
        params.len()
    );

    Ok(Some(params))
}
