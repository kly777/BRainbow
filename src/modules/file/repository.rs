use sqlx::{FromRow, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

use super::model::{FileTag, NewFile};

#[derive(Debug, FromRow)]
pub struct FileRow {
    pub id: i64,
    pub stored_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub file_category: String,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub user_id: Option<i64>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Clone)]
pub struct FileRepository {
    pub db: Arc<SqlitePool>,
}

impl FileRepository {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self { db }
    }

    /// 插入文件记录
    pub async fn insert(&self, params: NewFile<'_>) -> Result<FileRow, sqlx::Error> {
        let row = sqlx::query_as!(
            FileRow,
            r#"INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, width, height, duration_ms, user_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id AS "id!: i64", stored_id, original_name, mime_type, file_category,
                         size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            params.stored_id,
            params.original_name,
            params.mime_type,
            params.file_category,
            params.size_bytes,
            params.width,
            params.height,
            params.duration_ms,
            params.user_id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(row)
    }

    /// 根据 stored_id 查找文件
    pub async fn find_by_stored_id(&self, stored_id: &str) -> Result<Option<FileRow>, sqlx::Error> {
        let row = sqlx::query_as!(
            FileRow,
            r#"SELECT id, stored_id, original_name, mime_type, file_category,
                      size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM file WHERE stored_id = ?"#,
            stored_id
        )
        .fetch_optional(&*self.db)
        .await?;

        Ok(row)
    }

    /// 根据 id 查找文件
    pub async fn find_by_id(&self, id: i64) -> Result<Option<FileRow>, sqlx::Error> {
        let row = sqlx::query_as!(
            FileRow,
            r#"SELECT id, stored_id, original_name, mime_type, file_category,
                      size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM file WHERE id = ?"#,
            id
        )
        .fetch_optional(&*self.db)
        .await?;

        Ok(row)
    }

    /// 更新文件名
    pub async fn update_name(
        &self,
        stored_id: &str,
        new_name: &str,
    ) -> Result<Option<FileRow>, sqlx::Error> {
        let row = sqlx::query_as!(
            FileRow,
            r#"UPDATE file SET original_name = ?, updated_at = CURRENT_TIMESTAMP WHERE stored_id = ?
               RETURNING id AS "id!: i64", stored_id, original_name, mime_type, file_category,
                         size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                         COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                         COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>""#,
            new_name,
            stored_id
        )
        .fetch_optional(&*self.db)
        .await?;

        Ok(row)
    }

    /// 删除文件记录
    pub async fn delete(&self, stored_id: &str) -> Result<Option<FileRow>, sqlx::Error> {
        let existing = self.find_by_stored_id(stored_id).await?;
        if existing.is_some() {
            sqlx::query!("DELETE FROM file WHERE stored_id = ?", stored_id)
                .execute(&*self.db)
                .await?;
        }
        Ok(existing)
    }

    /// 统计文件数量
    pub async fn count(
        &self,
        category: Option<&str>,
        user_id: Option<i64>,
    ) -> Result<i64, sqlx::Error> {
        match (category, user_id) {
            (Some(cat), Some(uid)) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM file WHERE file_category = ? AND user_id = ?",
                    cat,
                    uid
                )
                .fetch_one(&*self.db)
                .await
            }
            (Some(cat), None) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM file WHERE file_category = ?",
                    cat
                )
                .fetch_one(&*self.db)
                .await
            }
            (None, Some(uid)) => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM file WHERE user_id = ?",
                    uid
                )
                .fetch_one(&*self.db)
                .await
            }
            (None, None) => {
                sqlx::query_scalar!("SELECT COUNT(*) FROM file")
                    .fetch_one(&*self.db)
                    .await
            }
        }
    }

    /// 分页查询文件列表
    pub async fn find_all(
        &self,
        limit: i64,
        offset: i64,
        category: Option<&str>,
        user_id: Option<i64>,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        match (category, user_id) {
            (Some(cat), Some(uid)) => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file WHERE file_category = ? AND user_id = ?
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    cat,
                    uid,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
            (Some(cat), None) => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file WHERE file_category = ?
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    cat,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
            (None, Some(uid)) => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file WHERE user_id = ?
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    uid,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
            (None, None) => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
        }
    }

    /// 按标签筛选文件（通过标签名）
    pub async fn find_by_tag(
        &self,
        tag_name: &str,
        user_id: i64,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            FileRow,
            r#"SELECT f.id AS "id!: i64", f.stored_id, f.original_name, f.mime_type, f.file_category,
                      f.size_bytes AS "size_bytes!: i64", f.width, f.height, f.duration_ms, f.user_id,
                      COALESCE(f.created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(f.updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM file f
               JOIN file_tag_rel ftr ON f.id = ftr.file_id
               JOIN file_tag ft ON ftr.tag_id = ft.id
               WHERE ft.name = ? AND ft.user_id = ?
               ORDER BY f.created_at DESC LIMIT ? OFFSET ?"#,
            tag_name,
            user_id,
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;

        Ok(rows)
    }

    /// 按文件名模糊搜索
    pub async fn search_by_name(
        &self,
        query: &str,
        user_id: Option<i64>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        let pattern = format!("%{query}%");
        match user_id {
            Some(uid) => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file WHERE original_name LIKE ? AND user_id = ?
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    pattern,
                    uid,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
            None => {
                sqlx::query_as!(
                    FileRow,
                    r#"SELECT id, stored_id, original_name, mime_type, file_category,
                              size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id,
                              COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                              COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
                       FROM file WHERE original_name LIKE ?
                       ORDER BY created_at DESC LIMIT ? OFFSET ?"#,
                    pattern,
                    limit,
                    offset
                )
                .fetch_all(&*self.db)
                .await
            }
        }
    }

    // ── 标签操作 ──

    /// 获取或创建标签
    pub async fn get_or_create_tag(
        &self,
        name: &str,
        user_id: i64,
    ) -> Result<FileTag, sqlx::Error> {
        // 先尝试查找
        let existing = sqlx::query_as!(
            FileTag,
            r#"SELECT id AS "id!: i64", name, user_id AS "user_id!: i64" FROM file_tag WHERE name = ? AND user_id = ?"#,
            name,
            user_id
        )
        .fetch_optional(&*self.db)
        .await?;

        if let Some(tag) = existing {
            return Ok(tag);
        }

        // 不存在则创建
        let row = sqlx::query_as!(
            FileTag,
            r#"INSERT INTO file_tag (name, user_id) VALUES (?, ?)
               RETURNING id AS "id!: i64", name, user_id AS "user_id!: i64""#,
            name,
            user_id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(row)
    }

    /// 设置文件标签（全量替换）
    pub async fn set_file_tags(
        &self,
        file_id: i64,
        tag_ids: &[i64],
    ) -> Result<(), sqlx::Error> {
        // 删除旧关联
        sqlx::query!("DELETE FROM file_tag_rel WHERE file_id = ?", file_id)
            .execute(&*self.db)
            .await?;

        // 插入新关联
        for &tag_id in tag_ids {
            sqlx::query!(
                "INSERT INTO file_tag_rel (file_id, tag_id) VALUES (?, ?)",
                file_id,
                tag_id
            )
            .execute(&*self.db)
            .await?;
        }

        Ok(())
    }

    /// 获取文件的标签列表
    pub async fn get_file_tags(&self, file_id: i64) -> Result<Vec<FileTag>, sqlx::Error> {
        let tags = sqlx::query_as!(
            FileTag,
            r#"SELECT ft.id AS "id!: i64", ft.name, ft.user_id AS "user_id!: i64"
               FROM file_tag ft
               JOIN file_tag_rel ftr ON ft.id = ftr.tag_id
               WHERE ftr.file_id = ?"#,
            file_id
        )
        .fetch_all(&*self.db)
        .await?;

        Ok(tags)
    }

    /// 获取用户的所有标签
    pub async fn get_user_tags(&self, user_id: i64) -> Result<Vec<FileTag>, sqlx::Error> {
        let tags = sqlx::query_as!(
            FileTag,
            r#"SELECT id AS "id!: i64", name, user_id AS "user_id!: i64" FROM file_tag WHERE user_id = ? ORDER BY name"#,
            user_id
        )
        .fetch_all(&*self.db)
        .await?;

        Ok(tags)
    }

    // ── 元信息操作 ──

    /// 设置文件元信息（全量替换）
    pub async fn set_file_meta(
        &self,
        file_id: i64,
        meta: &HashMap<String, String>,
    ) -> Result<(), sqlx::Error> {
        // 删除旧元信息
        sqlx::query!("DELETE FROM file_meta WHERE file_id = ?", file_id)
            .execute(&*self.db)
            .await?;

        // 插入新元信息
        for (key, value) in meta {
            sqlx::query!(
                "INSERT INTO file_meta (file_id, key, value) VALUES (?, ?, ?)",
                file_id,
                key,
                value
            )
            .execute(&*self.db)
            .await?;
        }

        Ok(())
    }

    /// 获取文件的元信息
    pub async fn get_file_meta(
        &self,
        file_id: i64,
    ) -> Result<HashMap<String, String>, sqlx::Error> {
        let rows = sqlx::query!(
            "SELECT key, value FROM file_meta WHERE file_id = ?",
            file_id
        )
        .fetch_all(&*self.db)
        .await?;

        let mut meta = HashMap::new();
        for row in rows {
            meta.insert(row.key, row.value);
        }

        Ok(meta)
    }

    /// 统计内容表中引用该文件的条数
    pub async fn count_content_references(&self, stored_id: &str) -> Result<usize, sqlx::Error> {
        let pattern = format!("%{stored_id}%");
        let row: Option<i64> = sqlx::query_scalar!(
            "SELECT
                (SELECT COUNT(*) FROM card WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM articles WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM chunk WHERE content LIKE ?) +
                (SELECT COUNT(*) FROM text_note WHERE content LIKE ?)",
            pattern,
            pattern,
            pattern,
            pattern
        )
        .fetch_one(&*self.db)
        .await?;
        Ok(row.unwrap_or(0) as usize)
    }

    /// 按标签统计文件数量
    pub async fn count_by_tag(
        &self,
        tag_name: &str,
        user_id: i64,
    ) -> Result<i64, sqlx::Error> {
        let count = sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM file f
               JOIN file_tag_rel ftr ON f.id = ftr.file_id
               JOIN file_tag ft ON ftr.tag_id = ft.id
               WHERE ft.name = ? AND ft.user_id = ?"#,
            tag_name,
            user_id
        )
        .fetch_one(&*self.db)
        .await?;

        Ok(count)
    }
}
