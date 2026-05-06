use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::Image;
use super::repository::ImageRepository;
use crate::pagination::{Pagination, PaginatedResponse};

pub struct ImageService {
    repo: ImageRepository,
}

impl ImageService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        std::fs::create_dir_all("uploads").ok();
        Self { repo: ImageRepository::new(db) }
    }

    pub async fn upload(
        &self,
        data: &[u8],
        original_name: &str,
        content_type: &str,
    ) -> Result<Image, String> {
        let ext = std::path::Path::new(original_name)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("bin");
        let filename = format!("{}.{}", uuid::Uuid::new_v4(), ext);
        let filepath = std::path::Path::new("uploads").join(&filename);

        tokio::fs::write(&filepath, data)
            .await
            .map_err(|e| format!("保存文件失败: {}", e))?;

        self.repo
            .insert(&filename, original_name, content_type)
            .await
            .map_err(|e| {
                let _ = std::fs::remove_file(&filepath);
                format!("数据库写入失败: {}", e)
            })
    }

    pub async fn list(&self, pagination: &Pagination) -> Result<PaginatedResponse<Image>, String> {
        let total = self.repo.count().await.map_err(|e| format!("查询失败: {}", e))?;
        let items = self
            .repo
            .find_all(pagination.limit(), pagination.offset())
            .await
            .map_err(|e| format!("查询失败: {}", e))?;
        Ok(PaginatedResponse::new(items, total, pagination))
    }

    pub async fn rename(&self, id: i32, new_name: &str) -> Result<Image, String> {
        self.repo
            .update_name(id, new_name)
            .await
            .map_err(|e| format!("更新失败: {}", e))?
            .ok_or_else(|| "图片不存在".to_string())
    }

    pub async fn delete(&self, id: i32) -> Result<(), String> {
        match self.repo.delete(id).await {
            Ok(Some(_)) => Ok(()),
            Ok(None) => Err("图片不存在".to_string()),
            Err(e) => Err(format!("删除失败: {}", e)),
        }
    }
}
