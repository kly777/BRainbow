use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

use super::model::Media;

#[derive(Debug, FromRow)]
struct MediaRow {
    id: i64,
    stored_id: String,
    original_name: String,
    media_type: String,
    mime_type: String,
    size_bytes: i64,
    width: Option<i64>,
    height: Option<i64>,
    duration_ms: Option<i64>,
    user_id: Option<i64>,
    created_at: chrono::DateTime<chrono::Utc>,
}

impl From<MediaRow> for Media {
    fn from(r: MediaRow) -> Self {
        let media_type = match r.media_type.as_str() {
            "video" => super::model::MediaType::Video,
            "audio" => super::model::MediaType::Audio,
            _ => super::model::MediaType::Image,
        };
        Media {
            id: r.id,
            stored_id: r.stored_id,
            original_name: r.original_name,
            media_type,
            mime_type: r.mime_type,
            size_bytes: r.size_bytes,
            width: r.width,
            height: r.height,
            duration_ms: r.duration_ms,
            user_id: r.user_id,
            created_at: r.created_at,
        }
    }
}

pub struct MediaRepository {
    db: Arc<SqlitePool>,
}

impl MediaRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn insert(
        &self,
        stored_id: &str,
        original_name: &str,
        media_type: &str,
        mime_type: &str,
        size_bytes: i64,
        width: Option<i64>,
        height: Option<i64>,
        duration_ms: Option<i64>,
        user_id: Option<i64>,
    ) -> Result<Media, sqlx::Error> {
        let row = sqlx::query_as::<_, MediaRow>(
            r#"INSERT INTO media (stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at"#,
        )
        .bind(stored_id)
        .bind(original_name)
        .bind(media_type)
        .bind(mime_type)
        .bind(size_bytes)
        .bind(width)
        .bind(height)
        .bind(duration_ms)
        .bind(user_id)
        .fetch_one(&*self.db)
        .await?;

        Ok(row.into())
    }

    pub async fn update_metadata(
        &self,
        id: i64,
        width: Option<i64>,
        height: Option<i64>,
        duration_ms: Option<i64>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE media SET width = ?, height = ?, duration_ms = ? WHERE id = ?")
            .bind(width)
            .bind(height)
            .bind(duration_ms)
            .bind(id)
            .execute(&*self.db)
            .await?;
        Ok(())
    }

    pub async fn count(&self, media_type: Option<&str>) -> Result<i64, sqlx::Error> {
        match media_type {
            Some(mt) => {
                sqlx::query_scalar("SELECT COUNT(*) FROM media WHERE media_type = ?")
                    .bind(mt)
                    .fetch_one(&*self.db)
                    .await
            }
            None => {
                sqlx::query_scalar("SELECT COUNT(*) FROM media")
                    .fetch_one(&*self.db)
                    .await
            }
        }
    }

    pub async fn find_all(
        &self,
        limit: i64,
        offset: i64,
        media_type: Option<&str>,
    ) -> Result<Vec<Media>, sqlx::Error> {
        let rows = match media_type {
            Some(mt) => {
                sqlx::query_as::<_, MediaRow>(
                    "SELECT id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at
                     FROM media WHERE media_type = ?
                     ORDER BY created_at DESC LIMIT ? OFFSET ?",
                )
                .bind(mt)
                .bind(limit)
                .bind(offset)
                .fetch_all(&*self.db)
                .await?
            }
            None => {
                sqlx::query_as::<_, MediaRow>(
                    "SELECT id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at
                     FROM media
                     ORDER BY created_at DESC LIMIT ? OFFSET ?",
                )
                .bind(limit)
                .bind(offset)
                .fetch_all(&*self.db)
                .await?
            }
        };
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn find_by_stored_id(&self, stored_id: &str) -> Result<Option<Media>, sqlx::Error> {
        let row = sqlx::query_as::<_, MediaRow>(
            "SELECT id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at
             FROM media WHERE stored_id = ?",
        )
        .bind(stored_id)
        .fetch_optional(&*self.db)
        .await?;

        Ok(row.map(Into::into))
    }

    pub async fn update_name(
        &self,
        stored_id: &str,
        new_name: &str,
    ) -> Result<Option<Media>, sqlx::Error> {
        let row = sqlx::query_as::<_, MediaRow>(
            "UPDATE media SET original_name = ? WHERE stored_id = ?
             RETURNING id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at",
        )
        .bind(new_name)
        .bind(stored_id)
        .fetch_optional(&*self.db)
        .await?;

        Ok(row.map(Into::into))
    }

    pub async fn delete(&self, stored_id: &str) -> Result<Option<Media>, sqlx::Error> {
        let existing = self.find_by_stored_id(stored_id).await?;
        sqlx::query("DELETE FROM media WHERE stored_id = ?")
            .bind(stored_id)
            .execute(&*self.db)
            .await?;
        Ok(existing)
    }
}
