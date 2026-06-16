use std::sync::Arc;

use super::model::Onto;
use super::repository::OntoRepository;
use crate::pagination::{PaginatedResponse, Pagination};

pub struct OntoService {
    onto_repository: OntoRepository,
}

impl OntoService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            onto_repository: OntoRepository::new(db),
        }
    }

    pub async fn get_ontos_paginated(
        &self,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<Onto>, String> {
        let (items, total) = self
            .onto_repository
            .find_all_paginated(pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_onto_by_id(&self, id: i32) -> Result<Option<Onto>, String> {
        self.onto_repository
            .find_by_id(id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_onto(
        &self,
        name: String,
        description: Option<String>,
    ) -> Result<Onto, String> {
        if name.trim().is_empty() {
            return Err("本体名称不能为空".to_string());
        }
        self.onto_repository
            .create(name, description)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn update_onto(
        &self,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> Result<Onto, String> {
        if let Some(ref name) = name {
            if name.trim().is_empty() {
                return Err("本体名称不能为空".to_string());
            }
        }
        self.onto_repository
            .update(id, name, description)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_onto(&self, id: i32) -> Result<u64, String> {
        self.onto_repository
            .delete(id)
            .await
            .map_err(|e| e.to_string())
    }
}
