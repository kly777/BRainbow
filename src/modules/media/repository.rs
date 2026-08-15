use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

use super::model::{Media, NewMedia};

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

#[derive(Clone)]
pub struct MediaRepository {
    db: Arc<SqlitePool>,
}

impl MediaRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    pub async fn insert(&self, params: NewMedia<'_>) -> Result<Media, sqlx::Error> {
        let row = sqlx::query_as::<_, MediaRow>(
            r#"INSERT INTO media (stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id, stored_id, original_name, media_type, mime_type, size_bytes, width, height, duration_ms, user_id, created_at"#,
        )
        .bind(params.stored_id)
        .bind(params.original_name)
        .bind(params.media_type)
        .bind(params.mime_type)
        .bind(params.size_bytes)
        .bind(params.width)
        .bind(params.height)
        .bind(params.duration_ms)
        .bind(params.user_id)
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

impl MediaRepository {
    /// 统计内容表（card/articles/mem/text_note/chunk）中引用该媒体文件的条数
    pub async fn count_content_references(&self, stored_id: &str) -> Result<usize, sqlx::Error> {
        let pattern = format!("%{stored_id}%");
        let row: (i64,) = sqlx::query_as(
            "SELECT
                (SELECT COUNT(*) FROM card WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM articles WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM chunk WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM text_note WHERE content LIKE ?)",
        )
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .fetch_one(&*self.db)
        .await?;
        Ok(row.0 as usize)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> MediaRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::create_tables(&pool).await.unwrap();
        // media.user_id 有外键约束，先建测试用户
        sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (7, 'media-user', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        MediaRepository::new(Arc::new(pool))
    }

    fn new_media<'a>(stored_id: &'a str, media_type: &'a str) -> NewMedia<'a> {
        NewMedia {
            stored_id,
            original_name: "file.bin",
            media_type,
            mime_type: "application/octet-stream",
            size_bytes: 42,
            width: Some(100),
            height: Some(80),
            duration_ms: None,
            user_id: Some(7),
        }
    }

    async fn insert(repo: &MediaRepository, stored_id: &str) -> Media {
        repo.insert(new_media(stored_id, "image"))
            .await
            .expect("insert media")
    }

    #[tokio::test]
    async fn insert_and_find_by_stored_id_round_trip() {
        let repo = setup().await;
        let created = insert(&repo, "abc123photo").await;

        let found = repo
            .find_by_stored_id("abc123photo")
            .await
            .unwrap()
            .expect("media should exist");
        assert_eq!(found.id, created.id);
        assert_eq!(found.stored_id, "abc123photo");
        assert_eq!(found.user_id, Some(7));
        assert_eq!(found.width, Some(100));
        assert_eq!(found.height, Some(80));
    }

    #[tokio::test]
    async fn find_all_and_count_filter_by_media_type() {
        let repo = setup().await;
        insert(&repo, "img-1").await;
        insert(&repo, "img-2").await;
        repo.insert(new_media("vid-1", "video")).await.unwrap();

        let images = repo.find_all(10, 0, Some("image")).await.unwrap();
        assert_eq!(images.len(), 2);
        assert!(images.iter().all(|m| m.stored_id.starts_with("img-")));

        assert_eq!(repo.count(Some("image")).await.unwrap(), 2);
        assert_eq!(repo.count(Some("video")).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn update_name_returns_renamed_row() {
        let repo = setup().await;
        insert(&repo, "abc123photo").await;

        let updated = repo
            .update_name("abc123photo", "renamed.png")
            .await
            .unwrap()
            .expect("media should exist");
        assert_eq!(updated.original_name, "renamed.png");
        assert!(repo.update_name("missing", "x").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_returns_existing_and_removes_row() {
        let repo = setup().await;
        let created = insert(&repo, "abc123photo").await;

        let deleted = repo.delete("abc123photo").await.unwrap().unwrap();
        assert_eq!(deleted.id, created.id);
        assert!(
            repo.find_by_stored_id("abc123photo")
                .await
                .unwrap()
                .is_none()
        );
        assert!(repo.delete("abc123photo").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn count_content_references_across_four_content_tables() {
        let repo = setup().await;
        insert(&repo, "abc123photo").await;

        // 同一 stored_id 出现在四张内容表中，应统计为 4 处引用
        for sql in [
            "INSERT INTO card (content) VALUES ('![x](/api/media/abc123photo/file)')",
            "INSERT INTO articles (conv_id, article_type, title, content) VALUES (1, 'concept', 't', 'see abc123photo here')",
            "INSERT INTO chunk (content) VALUES ('abc123photo')",
            "INSERT INTO text_note (name, content) VALUES ('n', 'note abc123photo')",
        ] {
            sqlx::query(sql).execute(&*repo.db).await.unwrap();
        }

        assert_eq!(
            repo.count_content_references("abc123photo").await.unwrap(),
            4
        );
        assert_eq!(repo.count_content_references("other").await.unwrap(), 0);
    }
}
