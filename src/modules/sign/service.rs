use std::sync::Arc;

use super::model::SignifierSignified;
use super::repository::SignRepository;
use crate::pagination::{PaginatedResponse, Pagination};

/// 符号关系服务层
pub struct SignService {
    sign_repository: SignRepository,
}

impl SignService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            sign_repository: SignRepository::new(db),
        }
    }

    pub async fn get_sign_by_id(&self, id: i32) -> Result<Option<SignifierSignified>, String> {
        self.sign_repository
            .find_by_id(id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn create_sign(
        &self,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<SignifierSignified, String> {
        if signifier.trim().is_empty() {
            return Err("能指不能为空".to_string());
        }
        if signified.trim().is_empty() {
            return Err("所指不能为空".to_string());
        }
        self.sign_repository
            .create(signifier, signified, onto_id, weight, relation_type)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn delete_sign(&self, id: i32) -> Result<u64, String> {
        self.sign_repository
            .delete(id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_signs_paginated(
        &self,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<SignifierSignified>, String> {
        let (items, total) = self
            .sign_repository
            .find_all_paginated(pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_signs_by_signifier_paginated(
        &self,
        signifier: &str,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<SignifierSignified>, String> {
        let (items, total) = self
            .sign_repository
            .find_by_signifier_paginated(signifier, pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn get_signs_by_signified_paginated(
        &self,
        signified: &str,
        pagination: &Pagination,
    ) -> Result<PaginatedResponse<SignifierSignified>, String> {
        let (items, total) = self
            .sign_repository
            .find_by_signified_paginated(signified, pagination.limit(), pagination.offset())
            .await
            .map_err(|e| e.to_string())?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }
}
