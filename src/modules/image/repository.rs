use sqlx::SqlitePool;
use std::sync::Arc;

use super::model::Image;
use super::UPLOAD_DIR;

pub struct ImageRepository {
    db: Arc<SqlitePool>,
}

impl ImageRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn insert(
        &self,
        filename: &str,
        original_name: &str,
        content_type: &str,
    ) -> Result<Image, sqlx::Error> {
        sqlx::query_as::<_, Image>(
            r#"INSERT INTO image (filename, original_name, content_type)
               VALUES (?, ?, ?)
               RETURNING id, filename, original_name, content_type, created_at"#,
        )
        .bind(filename)
        .bind(original_name)
        .bind(content_type)
        .fetch_one(&*self.db)
        .await
    }

    pub async fn count(&self) -> Result<i64, sqlx::Error> {
        sqlx::query_scalar("SELECT COUNT(*) FROM image")
            .fetch_one(&*self.db)
            .await
    }

    pub async fn find_all(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Image>, sqlx::Error> {
        sqlx::query_as::<_, Image>(
            "SELECT id, filename, original_name, content_type, created_at FROM image ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&*self.db)
        .await
    }

    pub async fn find_by_id(&self, id: i32) -> Result<Option<Image>, sqlx::Error> {
        sqlx::query_as::<_, Image>(
            "SELECT id, filename, original_name, content_type, created_at FROM image WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn update_name(&self, id: i32, new_name: &str) -> Result<Option<Image>, sqlx::Error> {
        sqlx::query_as::<_, Image>(
            r#"UPDATE image SET original_name = ? WHERE id = ?
               RETURNING id, filename, original_name, content_type, created_at"#,
        )
        .bind(new_name)
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    pub async fn delete(&self, id: i32) -> Result<Option<Image>, sqlx::Error> {
        let image = self.find_by_id(id).await?;
        if let Some(ref img) = image {
            let filepath = std::path::Path::new(UPLOAD_DIR).join(&img.filename);
            tokio::fs::remove_file(&filepath).await.ok();
        }
        sqlx::query("DELETE FROM image WHERE id = ?")
            .bind(id)
            .execute(&*self.db)
            .await?;
        Ok(image)
    }
}
