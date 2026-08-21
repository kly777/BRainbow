use async_trait::async_trait;

use super::model::{Media, NewMedia};

#[async_trait]
pub trait MediaRepositoryPort: Send + Sync {
    async fn insert(&self, params: NewMedia<'_>) -> Result<Media, sqlx::Error>;
    async fn update_metadata(
        &self,
        id: i64,
        width: Option<i64>,
        height: Option<i64>,
        duration_ms: Option<i64>,
    ) -> Result<(), sqlx::Error>;
    async fn count(&self, media_type: Option<&str>) -> Result<i64, sqlx::Error>;
    async fn find_all(
        &self,
        limit: i64,
        offset: i64,
        media_type: Option<&str>,
    ) -> Result<Vec<Media>, sqlx::Error>;
    async fn find_by_stored_id(&self, stored_id: &str) -> Result<Option<Media>, sqlx::Error>;
    async fn update_name(&self, stored_id: &str, new_name: &str) -> Result<Option<Media>, sqlx::Error>;
    async fn delete(&self, stored_id: &str) -> Result<Option<Media>, sqlx::Error>;
    async fn count_content_references(&self, stored_id: &str) -> Result<usize, sqlx::Error>;
}
