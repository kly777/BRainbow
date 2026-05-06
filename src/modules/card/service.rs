use crate::pagination::{Pagination, PaginatedResponse};
use std::sync::Arc;

use super::model::Card;
use super::repository::CardRepository;

/// 卡片服务层
pub struct CardService {
    card_repository: CardRepository,
}

impl CardService {
    /// 创建新的卡片服务层实例
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            card_repository: CardRepository::new(db),
        }
    }

    /// 获取所有卡片
    pub async fn get_all_cards(&self) -> Result<Vec<Card>, String> {
        self.card_repository
            .find_all()
            .await
            .map_err(|e| e.to_string())
    }

    /// 根据ID获取卡片
    pub async fn get_card_by_id(&self, id: i32) -> Result<Option<Card>, String> {
        self.card_repository
            .find_by_id(id)
            .await
            .map_err(|e| e.to_string())
    }

    /// 创建卡片
    pub async fn create_card(&self, content: String) -> Result<Card, String> {
        self.card_repository
            .create(content)
            .await
            .map_err(|e| e.to_string())
    }

    /// 更新卡片
    pub async fn update_card(
        &self,
        id: i32,
        content: Option<String>,
    ) -> Result<Card, String> {
        self.card_repository
            .update(id, content)
            .await
            .map_err(|e| e.to_string())
    }

    /// 删除卡片
    pub async fn delete_card(&self, id: i32) -> Result<u64, String> {
        self.card_repository
            .delete(id)
            .await
            .map_err(|e| e.to_string())
    }

    /// 搜索卡片
    pub async fn search_cards(&self, query: &str) -> Result<Vec<Card>, String> {
        self.card_repository
            .search_by_content(query)
            .await
            .map_err(|e| e.to_string())
    }

    /// 获取所有卡片（分页）
    pub async fn get_cards_paginated(
        &self,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<Card>, String> {
        let (items, total) = self
            .card_repository
            .find_all_paginated(pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    /// 搜索卡片（分页）
    pub async fn search_cards_paginated(
        &self,
        query: &str,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<Card>, String> {
        let (items, total) = self
            .card_repository
            .search_by_content_paginated(query, pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }
}