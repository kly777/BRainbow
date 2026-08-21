use axum::{
    extract::{Extension, Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::shared::claims::Claims;
use crate::shared::error_types::ErrorBody;
use crate::shared::pagination::{PaginatedResponse, Pagination};
use crate::shared::time_text::to_utc_iso;

use super::query::CardQueryService;
use super::service::CardService;

#[derive(Debug, Deserialize)]
pub struct CreateCardRequest {
    pub content: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateCardRequest {
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct CardResponse {
    pub id: i32,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<super::model::Card> for CardResponse {
    fn from(c: super::model::Card) -> Self {
        Self {
            id: c.id,
            content: c.content,
            created_at: to_utc_iso(c.created_at),
            updated_at: to_utc_iso(c.updated_at),
        }
    }
}

pub async fn create_card_handler(
    State(service): State<CardService>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<CreateCardRequest>,
) -> impl IntoResponse {
    match service.create(claims.sub, payload.content).await {
        Ok(card) => (StatusCode::CREATED, Json(CardResponse::from(card))).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn get_cards_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<CardQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    match query
        .list(claims.sub, pagination.limit(), pagination.offset())
        .await
    {
        Ok((items, total)) => {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}

pub async fn get_card_handler(
    State(query): State<CardQueryService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match query.by_id(claims.sub, id).await {
        Ok(Some(card)) => Json(CardResponse::from(card)).into_response(),
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(ErrorBody {
                code: "NOT_FOUND".into(),
                message: "卡片不存在".into(),
                details: None,
            }),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn update_card_handler(
    State(service): State<CardService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    match service.update(claims.sub, id, payload.content).await {
        Ok(card) => Json(CardResponse::from(card)).into_response(),
        Err(e) => e.into_response(),
    }
}

pub async fn delete_card_handler(
    State(service): State<CardService>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    match service.delete(claims.sub, id).await {
        Ok(n) if n > 0 => StatusCode::NO_CONTENT.into_response(),
        Ok(_) => (
            StatusCode::NOT_FOUND,
            Json(ErrorBody {
                code: "NOT_FOUND".into(),
                message: "卡片不存在".into(),
                details: None,
            }),
        )
            .into_response(),
        Err(e) => e.into_response(),
    }
}

#[derive(Debug, Deserialize)]
pub struct SearchCardsQuery {
    pub q: String,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

impl SearchCardsQuery {
    fn pagination(&self) -> Pagination {
        Pagination {
            page: self.page.unwrap_or(1),
            page_size: self.page_size.unwrap_or(20),
        }
    }
}

pub async fn search_cards_handler(
    Query(params): Query<SearchCardsQuery>,
    State(query): State<CardQueryService>,
    Extension(claims): Extension<Claims>,
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorBody {
                code: "INVALID_INPUT".into(),
                message: "搜索关键词不能为空".into(),
                details: None,
            }),
        )
            .into_response();
    }
    let pagination = params.pagination();
    match query
        .search(
            claims.sub,
            params.q.trim(),
            pagination.limit(),
            pagination.offset(),
        )
        .await
    {
        Ok((items, total)) => {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            Json(PaginatedResponse::new(items, total, &pagination)).into_response()
        }
        Err(e) => e.into_response(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use chrono::{DateTime, Utc};

    #[test]
    fn card_response_formats_time_to_iso_utc_without_fraction() {
        let dt = DateTime::parse_from_rfc3339("2026-08-07T07:13:43.540234635+00:00")
            .unwrap()
            .with_timezone(&Utc);
        let card = super::super::model::Card {
            id: 1,
            content: "x".into(),
            created_at: dt,
            updated_at: dt,
        };
        let response = CardResponse::from(card);
        assert_eq!(response.created_at, "2026-08-07T07:13:43+00:00");
        assert_eq!(response.updated_at, "2026-08-07T07:13:43+00:00");
    }
}
