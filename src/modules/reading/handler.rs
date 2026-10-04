use axum::{
    Json,
    extract::{Extension, Path, State},
    response::IntoResponse,
};
use serde_json::json;

use crate::shared::actor::Actor;
use crate::shared::error_types as error;
use crate::shared::response;

use super::model::{MarkWordRequest, UploadArticleRequest};
use super::query::ReadingQueryService;
use super::service::ReadingService;

/// 文章列表（含认识率）
pub async fn list_articles(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query.list_articles(&actor).await {
        Ok(summaries) => Json(json!({"articles": summaries})).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 上传文章
pub async fn upload_article(
    State(service): State<ReadingService>,
    Extension(actor): Extension<Actor>,
    Json(body): Json<UploadArticleRequest>,
) -> impl IntoResponse {
    match service
        .upload_article(&actor, &body.title, &body.content)
        .await
    {
        Ok(article) => Json(json!({"article": article})).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 获取单篇文章详情（含词状态 + notes）
pub async fn get_article(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article_detail(&actor, id).await {
        Ok(Some(detail)) => Json(detail).into_response(),
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => e.into_response(),
    }
}

/// 获取文章中的所有词
pub async fn get_article_words(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article_words(&actor, id).await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 标记单词
pub async fn mark_word(
    State(service): State<ReadingService>,
    Extension(actor): Extension<Actor>,
    Path(word): Path<String>,
    Json(body): Json<MarkWordRequest>,
) -> impl IntoResponse {
    match service.mark_word(&actor, &word, body.status).await {
        Ok(()) => response::ok().into_response(),
        Err(e) => e.into_response(),
    }
}

/// 获取所有不认识词
pub async fn list_unknown_words(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
) -> impl IntoResponse {
    match query.unknown_words(&actor).await {
        Ok(words) => Json(json!({"words": words})).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 推荐下一篇（认识率最接近 90%）
pub async fn recommend_next(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.recommend_next(&actor, id).await {
        Ok(article) => Json(json!({"recommended": article})).into_response(),
        Err(e) => e.into_response(),
    }
}

/// 获取文章笔记
pub async fn get_notes(
    State(query): State<ReadingQueryService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
) -> impl IntoResponse {
    match query.article(&actor, id).await {
        Ok(Some(article)) => Json(json!({"notes": article.notes})).into_response(),
        Ok(None) => error::not_found("文章未找到"),
        Err(e) => e.into_response(),
    }
}

/// 更新文章笔记
pub async fn update_notes(
    State(service): State<ReadingService>,
    Extension(actor): Extension<Actor>,
    Path(id): Path<i64>,
    Json(body): Json<serde_json::Value>,
) -> impl IntoResponse {
    let notes = body.get("notes").and_then(|v| v.as_str()).unwrap_or("");
    match service.update_notes(&actor, id, notes).await {
        Ok(()) => response::ok().into_response(),
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::shared::error_types::ErrorBody;
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    async fn pool() -> Arc<SqlitePool> {
        let pool = SqlitePool::connect("sqlite::memory:").await.expect("db");
        crate::db::migrate(&pool).await.expect("schema");
        Arc::new(pool)
    }

    /// 测试调用者：普通用户 1（handler 现在从认证中间件拿到的就是这个类型）
    fn actor() -> Actor {
        Actor::user(1)
    }

    async fn body_of(response: axum::response::Response) -> (StatusCode, ErrorBody) {
        let status = response.status();
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        (status, serde_json::from_slice(&bytes).unwrap())
    }

    /// handler 只做 HTTP 转换：service 的业务校验要原样落到状态码上（曾一律 500）
    #[tokio::test]
    async fn business_error_keeps_its_status_code() {
        let state = State(ReadingService::new(pool().await));
        let body = Json(UploadArticleRequest {
            title: String::new(),
            content: "hello world".into(),
        });

        let (status, body) = body_of(
            upload_article(state, Extension(actor()), body)
                .await
                .into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body.code, "INVALID_INPUT");
        assert_eq!(body.message, "文章标题不能为空");
    }

    /// 500 的诊断只进日志：正文是通用文案，不含 SQL / 表名
    #[tokio::test]
    async fn db_failure_hides_the_raw_sqlite_text() {
        let db = pool().await;
        sqlx::query("DROP TABLE reading_article")
            .execute(db.as_ref())
            .await
            .unwrap();

        let state = State(ReadingQueryService::new(db));
        let (status, body) = body_of(
            list_articles(state, Extension(actor()))
                .await
                .into_response(),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body.code, "DB_ERROR");
        assert_eq!(body.message, "数据库操作失败");
    }
}
