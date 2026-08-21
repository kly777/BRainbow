use axum::{
    extract::{Path, Query, State},
    response::{IntoResponse, Json},
};
use serde::{Deserialize, Serialize};

use crate::shared::error_types as error;
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
    Json(payload): Json<CreateCardRequest>,
) -> impl IntoResponse {
    let result = service
        .create(payload.content)
        .await
        .map(CardResponse::from);
    error::created_or(result, "创建卡片")
}

pub async fn get_cards_handler(
    Query(pagination): Query<Pagination>,
    State(query): State<CardQueryService>,
) -> impl IntoResponse {
    let result = query
        .list(pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "获取卡片列表")
}

pub async fn get_card_handler(
    State(query): State<CardQueryService>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    let result = query.by_id(id).await.map(|opt| opt.map(CardResponse::from));
    error::found_or(result, "获取卡片")
}

pub async fn update_card_handler(
    State(service): State<CardService>,
    Path(id): Path<i32>,
    Json(payload): Json<UpdateCardRequest>,
) -> impl IntoResponse {
    let result = service
        .update(id, payload.content)
        .await
        .map(CardResponse::from);
    error::ok_or(result, "更新卡片")
}

pub async fn delete_card_handler(
    State(service): State<CardService>,
    Path(id): Path<i32>,
) -> impl IntoResponse {
    error::deleted_or(service.delete(id).await, "删除卡片")
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
) -> impl IntoResponse {
    if params.q.trim().is_empty() {
        return error::bad_request("搜索关键词不能为空");
    }
    let pagination = params.pagination();
    let result = query
        .search(params.q.trim(), pagination.limit(), pagination.offset())
        .await
        .map(|(items, total)| {
            let items: Vec<CardResponse> = items.into_iter().map(CardResponse::from).collect();
            PaginatedResponse::new(items, total, &pagination)
        });
    error::ok_or(result, "搜索卡片")
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
