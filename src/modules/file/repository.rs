use sqlx::{FromRow, QueryBuilder, SqlitePool};
use std::collections::HashMap;
use std::sync::Arc;

use super::model::{FileTag, FileTagWithCount, NewFile, SortOrder};
use crate::shared::db_query::like_contains;

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
    pub content_hash: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// 全局搜索命中行：文件基础信息 + 命中的标签名（文件名未命中时用于片段）
#[derive(Debug, FromRow)]
pub struct FileSearchHit {
    pub id: i64,
    /// 详情页路由参数（`/file/:stored_id`）
    pub stored_id: String,
    pub original_name: String,
    pub file_category: String,
    pub size_bytes: i64,
    /// 首个命中的标签名（无命中为 NULL）
    pub matched_tag: Option<String>,
    /// 0 = 文件名命中，1 = 仅标签命中（排序用，也可以用来打分）
    pub name_hit: i64,
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
            r#"INSERT INTO file (stored_id, original_name, mime_type, file_category, size_bytes, width, height, duration_ms, user_id, content_hash)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id AS "id!: i64", stored_id, original_name, mime_type, file_category,
                         size_bytes AS "size_bytes!: i64",
                         width AS "width?: i64", height AS "height?: i64",
                         duration_ms AS "duration_ms?: i64", user_id AS "user_id?: i64",
                         content_hash AS "content_hash?: String",
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
            params.user_id,
            params.content_hash
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
                      size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id, content_hash,
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
                      size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id, content_hash,
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM file WHERE id = ?"#,
            id
        )
        .fetch_optional(&*self.db)
        .await?;

        Ok(row)
    }

    /// 按内容哈希全局查重（同一内容全系统唯一；NULL 哈希不参与匹配）
    pub async fn find_by_hash(&self, content_hash: &str) -> Result<Option<FileRow>, sqlx::Error> {
        let row = sqlx::query_as!(
            FileRow,
            r#"SELECT id, stored_id, original_name, mime_type, file_category,
                      size_bytes AS "size_bytes!: i64", width, height, duration_ms, user_id, content_hash,
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM file
               WHERE content_hash = ?
               ORDER BY id ASC LIMIT 1"#,
            content_hash
        )
        .fetch_optional(&*self.db)
        .await?;

        Ok(row)
    }

    /// 文件库统计：总数、总占用、按类别分布（QueryBuilder 处理可选 user_id）
    pub async fn stats(
        &self,
        user_id: Option<i64>,
    ) -> Result<(i64, i64, Vec<(String, i64, i64)>), sqlx::Error> {
        let mut totals = QueryBuilder::new(
            "SELECT COUNT(*) AS count, COALESCE(SUM(f.size_bytes), 0) AS bytes FROM file f WHERE 1 = 1",
        );
        if let Some(uid) = user_id {
            totals.push(" AND f.user_id = ").push_bind(uid);
        }
        let (total_count, total_bytes): (i64, i64) =
            totals.build_query_as().fetch_one(&*self.db).await?;

        let mut by_cat = QueryBuilder::new(
            "SELECT f.file_category AS category, COUNT(*) AS count, COALESCE(SUM(f.size_bytes), 0) AS bytes FROM file f WHERE 1 = 1",
        );
        if let Some(uid) = user_id {
            by_cat.push(" AND f.user_id = ").push_bind(uid);
        }
        by_cat.push(" GROUP BY f.file_category ORDER BY bytes DESC");
        let rows: Vec<(String, i64, i64)> = by_cat.build_query_as().fetch_all(&*self.db).await?;

        Ok((total_count, total_bytes, rows))
    }

    /// 列出缺 content_hash 的记录（id + stored_id），供启动回填使用
    pub async fn find_without_hash(&self) -> Result<Vec<(i64, String)>, sqlx::Error> {
        let rows = sqlx::query!(
            "SELECT id AS \"id!: i64\", stored_id FROM file WHERE content_hash IS NULL ORDER BY id"
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows.into_iter().map(|r| (r.id, r.stored_id)).collect())
    }

    /// 写入 content_hash（回填用；撞唯一索引时报错由调用方跳过）
    pub async fn set_content_hash(&self, id: i64, hash: &str) -> Result<(), sqlx::Error> {
        sqlx::query!("UPDATE file SET content_hash = ? WHERE id = ?", hash, id)
            .execute(&*self.db)
            .await?;
        Ok(())
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
                         size_bytes AS "size_bytes!: i64",
                         width AS "width?: i64", height AS "height?: i64",
                         duration_ms AS "duration_ms?: i64", user_id AS "user_id?: i64",
                         content_hash AS "content_hash?: String",
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
                sqlx::query_scalar!("SELECT COUNT(*) FROM file WHERE file_category = ?", cat)
                    .fetch_one(&*self.db)
                    .await
            }
            (None, Some(uid)) => {
                sqlx::query_scalar!("SELECT COUNT(*) FROM file WHERE user_id = ?", uid)
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
        sort: SortOrder,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        // 动态 WHERE + 白名单 ORDER BY：避免为「筛选 × 排序」组合写 N 个静态查询
        let mut qb = QueryBuilder::new(
            "SELECT f.id, f.stored_id, f.original_name, f.mime_type, f.file_category, f.size_bytes, f.width, f.height, f.duration_ms, f.user_id, f.content_hash, COALESCE(f.created_at, CURRENT_TIMESTAMP) AS created_at, COALESCE(f.updated_at, CURRENT_TIMESTAMP) AS updated_at FROM file f WHERE 1 = 1",
        );
        if let Some(cat) = category {
            qb.push(" AND f.file_category = ").push_bind(cat);
        }
        if let Some(uid) = user_id {
            qb.push(" AND f.user_id = ").push_bind(uid);
        }
        qb.push(sort.order_by());
        qb.push(" LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);

        qb.build_query_as::<FileRow>().fetch_all(&*self.db).await
    }

    /// 按标签筛选文件（通过标签名），可选按文件名模糊过滤
    pub async fn find_by_tag(
        &self,
        tag_name: &str,
        user_id: i64,
        name_query: Option<&str>,
        limit: i64,
        offset: i64,
        sort: SortOrder,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        let mut qb = QueryBuilder::new(
            "SELECT f.id, f.stored_id, f.original_name, f.mime_type, f.file_category, f.size_bytes, f.width, f.height, f.duration_ms, f.user_id, f.content_hash, COALESCE(f.created_at, CURRENT_TIMESTAMP) AS created_at, COALESCE(f.updated_at, CURRENT_TIMESTAMP) AS updated_at FROM file f JOIN file_tag_rel ftr ON f.id = ftr.file_id JOIN file_tag ft ON ftr.tag_id = ft.id WHERE ft.name = ",
        );
        qb.push_bind(tag_name)
            .push(" AND ft.user_id = ")
            .push_bind(user_id);
        if let Some(q) = name_query {
            qb.push(" AND f.original_name LIKE ")
                .push_bind(like_contains(q))
                .push(" ESCAPE '\\'");
        }
        qb.push(sort.order_by());
        qb.push(" LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);

        qb.build_query_as::<FileRow>().fetch_all(&*self.db).await
    }

    /// 按文件名模糊统计
    pub async fn count_by_name(
        &self,
        query: &str,
        user_id: Option<i64>,
    ) -> Result<i64, sqlx::Error> {
        let pattern = like_contains(query);
        match user_id {
            Some(uid) => sqlx::query_scalar!(
                "SELECT COUNT(*) FROM file WHERE original_name LIKE ? ESCAPE '\\' AND user_id = ?",
                pattern,
                uid
            )
            .fetch_one(&*self.db)
            .await,
            None => {
                sqlx::query_scalar!(
                    "SELECT COUNT(*) FROM file WHERE original_name LIKE ? ESCAPE '\\'",
                    pattern
                )
                .fetch_one(&*self.db)
                .await
            }
        }
    }

    /// 按文件名模糊搜索
    pub async fn search_by_name(
        &self,
        query: &str,
        user_id: Option<i64>,
        limit: i64,
        offset: i64,
        sort: SortOrder,
    ) -> Result<Vec<FileRow>, sqlx::Error> {
        let mut qb = QueryBuilder::new(
            "SELECT f.id, f.stored_id, f.original_name, f.mime_type, f.file_category, f.size_bytes, f.width, f.height, f.duration_ms, f.user_id, f.content_hash, COALESCE(f.created_at, CURRENT_TIMESTAMP) AS created_at, COALESCE(f.updated_at, CURRENT_TIMESTAMP) AS updated_at FROM file f WHERE f.original_name LIKE ",
        );
        qb.push_bind(like_contains(query)).push(" ESCAPE '\\'");
        if let Some(uid) = user_id {
            qb.push(" AND f.user_id = ").push_bind(uid);
        }
        qb.push(sort.order_by());
        qb.push(" LIMIT ")
            .push_bind(limit)
            .push(" OFFSET ")
            .push_bind(offset);

        qb.build_query_as::<FileRow>().fetch_all(&*self.db).await
    }

    // ── 一致性扫描 ──

    /// 全部文件的 stored_id（DB → 磁盘方向的一致性比对用）
    pub async fn all_stored_ids(&self) -> Result<Vec<String>, sqlx::Error> {
        sqlx::query_scalar!("SELECT stored_id FROM file")
            .fetch_all(&*self.db)
            .await
    }

    // ── 全局搜索 ──

    /// 全局搜索：文件名或标签名命中，文件名命中排在前面。
    ///
    /// `like` 由 `like_contains` 生成（已转义 `%` / `_` / `\`），
    /// SQL 里用 `?1` 复用同一个模式串。
    pub async fn search_hits(
        &self,
        user_id: i64,
        like: &str,
        limit: i64,
    ) -> Result<Vec<FileSearchHit>, sqlx::Error> {
        sqlx::query_as!(
            FileSearchHit,
            r#"SELECT f.id AS "id!: i64",
                      f.stored_id,
                      f.original_name,
                      f.file_category,
                      f.size_bytes AS "size_bytes!: i64",
                      (SELECT t.name FROM file_tag_rel r
                         JOIN file_tag t ON t.id = r.tag_id
                        WHERE r.file_id = f.id AND t.name LIKE ?1 ESCAPE '\'
                        ORDER BY t.name LIMIT 1) AS "matched_tag?: String",
                      CASE WHEN f.original_name LIKE ?1 ESCAPE '\' THEN 0 ELSE 1 END AS "name_hit!: i64"
                 FROM file f
                WHERE f.user_id = ?2
                  AND (f.original_name LIKE ?1 ESCAPE '\'
                       OR EXISTS (SELECT 1 FROM file_tag_rel r2
                                    JOIN file_tag t2 ON t2.id = r2.tag_id
                                   WHERE r2.file_id = f.id AND t2.name LIKE ?1 ESCAPE '\'))
                ORDER BY CASE WHEN f.original_name LIKE ?1 ESCAPE '\' THEN 0 ELSE 1 END,
                         f.created_at DESC
                LIMIT ?3"#,
            like,
            user_id,
            limit
        )
        .fetch_all(&*self.db)
        .await
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
    pub async fn set_file_tags(&self, file_id: i64, tag_ids: &[i64]) -> Result<(), sqlx::Error> {
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

    /// 批量取多个文件的标签名（列表页用，避免逐个文件查询的 N+1）
    pub async fn get_tags_for_files(
        &self,
        file_ids: &[i64],
    ) -> Result<HashMap<i64, Vec<String>>, sqlx::Error> {
        if file_ids.is_empty() {
            return Ok(HashMap::new());
        }
        // 动态 IN：id 列表长度不定，用 QueryBuilder（不参与 sqlx 宏静态校验）
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT r.file_id AS file_id, t.name AS name
             FROM file_tag_rel r JOIN file_tag t ON r.tag_id = t.id
             WHERE r.file_id IN (",
        );
        let mut sep = qb.separated(", ");
        for id in file_ids {
            sep.push_bind(*id);
        }
        qb.push(")");

        let rows: Vec<(i64, String)> = qb.build_query_as().fetch_all(&*self.db).await?;
        let mut map: HashMap<i64, Vec<String>> = HashMap::new();
        for (file_id, name) in rows {
            map.entry(file_id).or_default().push(name);
        }
        Ok(map)
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

    /// 获取用户的所有标签及关联文件数（标签管理用）
    pub async fn get_user_tags_with_count(
        &self,
        user_id: i64,
    ) -> Result<Vec<FileTagWithCount>, sqlx::Error> {
        let rows = sqlx::query_as!(
            FileTagWithCount,
            r#"SELECT t.id AS "id!: i64", t.name,
                      COUNT(r.file_id) AS "count!: i64"
               FROM file_tag t
               LEFT JOIN file_tag_rel r ON r.tag_id = t.id
               WHERE t.user_id = ?
               GROUP BY t.id, t.name
               ORDER BY t.name"#,
            user_id
        )
        .fetch_all(&*self.db)
        .await?;

        Ok(rows)
    }

    /// 标签是否属于该用户（越权保护）
    pub async fn tag_owned_by(&self, tag_id: i64, user_id: i64) -> Result<bool, sqlx::Error> {
        let found: Option<i64> =
            sqlx::query_scalar("SELECT id FROM file_tag WHERE id = ? AND user_id = ?")
                .bind(tag_id)
                .bind(user_id)
                .fetch_optional(&*self.db)
                .await?;
        Ok(found.is_some())
    }

    /// 重命名标签（同用户下名称唯一，冲突由唯一约束兜底）
    pub async fn rename_tag(&self, tag_id: i64, name: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE file_tag SET name = ? WHERE id = ?")
            .bind(name)
            .bind(tag_id)
            .execute(&*self.db)
            .await?;
        Ok(())
    }

    /// 删除标签（关联记录级联删除，文件本身不受影响）
    pub async fn delete_tag(&self, tag_id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM file_tag WHERE id = ?")
            .bind(tag_id)
            .execute(&*self.db)
            .await?;
        Ok(())
    }

    /// 合并标签：把 from_tag 的关联移到 to_tag 后删除 from_tag（事务内完成）
    pub async fn merge_tags(&self, from_tag: i64, to_tag: i64) -> Result<(), sqlx::Error> {
        let mut tx = self.db.begin().await?;

        // 目标标签已有该文件的关联则跳过（避免主键冲突）
        sqlx::query(
            "INSERT OR IGNORE INTO file_tag_rel (file_id, tag_id)
             SELECT file_id, ? FROM file_tag_rel WHERE tag_id = ?",
        )
        .bind(to_tag)
        .bind(from_tag)
        .execute(&mut *tx)
        .await?;

        sqlx::query("DELETE FROM file_tag WHERE id = ?")
            .bind(from_tag)
            .execute(&mut *tx)
            .await?;

        tx.commit().await
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

    /// 按标签统计文件数量，可选按文件名模糊过滤
    pub async fn count_by_tag(
        &self,
        tag_name: &str,
        user_id: i64,
        name_query: Option<&str>,
    ) -> Result<i64, sqlx::Error> {
        match name_query {
            Some(q) => {
                let pattern = like_contains(q);
                sqlx::query_scalar!(
                    r#"SELECT COUNT(*) FROM file f
                       JOIN file_tag_rel ftr ON f.id = ftr.file_id
                       JOIN file_tag ft ON ftr.tag_id = ft.id
                       WHERE ft.name = ? AND ft.user_id = ? AND f.original_name LIKE ? ESCAPE '\'"#,
                    tag_name,
                    user_id,
                    pattern
                )
                .fetch_one(&*self.db)
                .await
            }
            None => {
                sqlx::query_scalar!(
                    r#"SELECT COUNT(*) FROM file f
                       JOIN file_tag_rel ftr ON f.id = ftr.file_id
                       JOIN file_tag ft ON ftr.tag_id = ft.id
                       WHERE ft.name = ? AND ft.user_id = ?"#,
                    tag_name,
                    user_id
                )
                .fetch_one(&*self.db)
                .await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    async fn setup() -> FileRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        // file.user_id / file_tag.user_id 有外键约束，先建两个测试用户（7 与 8 用于隔离断言）
        for (id, name) in [(7, "file-user"), (8, "other-user")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&pool)
                .await
                .unwrap();
        }
        FileRepository::new(Arc::new(pool))
    }

    fn new_file<'a>(stored_id: &'a str, category: &'a str, user_id: Option<i64>) -> NewFile<'a> {
        NewFile {
            stored_id,
            original_name: "file.bin",
            mime_type: "application/octet-stream",
            file_category: category,
            size_bytes: 42,
            width: Some(100),
            height: Some(80),
            duration_ms: None,
            user_id,
            content_hash: None,
        }
    }

    fn new_file_named<'a>(
        stored_id: &'a str,
        original_name: &'a str,
        category: &'a str,
        user_id: Option<i64>,
    ) -> NewFile<'a> {
        NewFile {
            stored_id,
            original_name,
            mime_type: "application/octet-stream",
            file_category: category,
            size_bytes: 42,
            width: None,
            height: None,
            duration_ms: None,
            user_id,
            content_hash: None,
        }
    }

    async fn insert(repo: &FileRepository, stored_id: &str) -> FileRow {
        repo.insert(new_file(stored_id, "image", Some(7)))
            .await
            .expect("insert file")
    }

    /// 显式错开 created_at（默认同秒会导致 DESC 排序断言不稳定）
    async fn insert_at(repo: &FileRepository, stored_id: &str, created_at: &str) -> FileRow {
        let row = insert(repo, stored_id).await;
        sqlx::query("UPDATE file SET created_at = ? WHERE id = ?")
            .bind(created_at)
            .bind(row.id)
            .execute(&*repo.db)
            .await
            .unwrap();
        row
    }

    // ── 基础 CRUD ──

    #[tokio::test]
    async fn insert_and_find_by_stored_id_round_trip() {
        let repo = setup().await;
        let created = insert(&repo, "abc123photo").await;

        let found = repo
            .find_by_stored_id("abc123photo")
            .await
            .unwrap()
            .expect("file should exist");
        assert_eq!(found.id, created.id);
        assert_eq!(found.stored_id, "abc123photo");
        assert_eq!(found.user_id, Some(7));
        assert_eq!(found.width, Some(100));
        assert_eq!(found.height, Some(80));
        assert_eq!(found.size_bytes, 42);
        assert_eq!(found.file_category, "image");
    }

    #[tokio::test]
    async fn insert_duplicate_stored_id_rejected() {
        let repo = setup().await;
        insert(&repo, "dup-id").await;
        // stored_id UNIQUE 约束：重复插入必须失败
        let err = repo.insert(new_file("dup-id", "image", Some(7))).await;
        assert!(err.is_err());
    }

    #[tokio::test]
    async fn find_by_id_and_missing_queries() {
        let repo = setup().await;
        let created = insert(&repo, "by-id").await;
        assert_eq!(
            repo.find_by_id(created.id)
                .await
                .unwrap()
                .unwrap()
                .stored_id,
            "by-id"
        );
        assert!(repo.find_by_id(9999).await.unwrap().is_none());
        assert!(repo.find_by_stored_id("missing").await.unwrap().is_none());
    }

    // ── 内容哈希查重 ──

    #[tokio::test]
    async fn find_by_hash_is_global_and_ignores_null_hash() {
        let repo = setup().await;
        // 用户 7 一条带哈希、用户 8 另一哈希、以及若干无哈希记录
        repo.insert(NewFile {
            content_hash: Some("hash-aaa"),
            ..new_file("owner-a", "image", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            content_hash: Some("hash-bbb"),
            ..new_file("owner-b", "image", Some(8))
        })
        .await
        .unwrap();
        insert(&repo, "no-hash-1").await; // content_hash: None
        insert(&repo, "no-hash-2").await; // NULL 可并列，不受唯一索引约束

        // 全局命中：不区分归属
        let hit = repo
            .find_by_hash("hash-aaa")
            .await
            .unwrap()
            .expect("应命中");
        assert_eq!(hit.stored_id, "owner-a");
        assert_eq!(hit.user_id, Some(7));

        // 未知哈希不命中
        assert!(repo.find_by_hash("hash-zzz").await.unwrap().is_none());
        // NULL 哈希不参与匹配（存量无哈希记录不会被误当作重复）
        assert!(repo.find_by_hash("").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn duplicate_content_hash_rejected_by_unique_index() {
        let repo = setup().await;
        repo.insert(NewFile {
            content_hash: Some("dup-hash"),
            ..new_file("first", "image", Some(7))
        })
        .await
        .unwrap();

        // 同哈希第二条必须被唯一索引拒绝（并发去重的兜底）
        let err = repo
            .insert(NewFile {
                content_hash: Some("dup-hash"),
                ..new_file("second", "image", Some(8))
            })
            .await;
        assert!(err.is_err(), "content_hash 唯一索引应拒绝重复");
    }

    // ── 列表 / 筛选 / 分页 ──

    #[tokio::test]
    async fn find_all_paginates_and_orders_created_desc() {
        let repo = setup().await;
        insert_at(&repo, "first", "2026-09-09T10:00:00+00:00").await;
        insert_at(&repo, "second", "2026-09-09T11:00:00+00:00").await;
        insert_at(&repo, "third", "2026-09-09T12:00:00+00:00").await;

        let page1 = repo
            .find_all(2, 0, None, Some(7), SortOrder::default())
            .await
            .unwrap();
        assert_eq!(page1.len(), 2);
        // created_at DESC：后插入的在前
        assert_eq!(page1[0].stored_id, "third");
        assert_eq!(page1[1].stored_id, "second");

        let page2 = repo
            .find_all(2, 2, None, Some(7), SortOrder::default())
            .await
            .unwrap();
        assert_eq!(page2.len(), 1);
        assert_eq!(page2[0].stored_id, "first");
    }

    #[tokio::test]
    async fn find_all_and_count_filter_by_category_and_user() {
        let repo = setup().await;
        insert(&repo, "img-1").await;
        insert(&repo, "img-2").await;
        repo.insert(new_file("vid-1", "video", Some(7)))
            .await
            .unwrap();
        // 其他用户的文件不应出现在 7 的列表
        repo.insert(new_file("img-3", "image", Some(8)))
            .await
            .unwrap();

        let images = repo
            .find_all(10, 0, Some("image"), Some(7), SortOrder::default())
            .await
            .unwrap();
        assert_eq!(images.len(), 2);
        assert!(images.iter().all(|f| f.stored_id.starts_with("img-")));

        assert_eq!(repo.count(Some("image"), Some(7)).await.unwrap(), 2);
        assert_eq!(repo.count(Some("video"), Some(7)).await.unwrap(), 1);
        assert_eq!(repo.count(None, Some(7)).await.unwrap(), 3);
        // 用户 8 只能看到自己的
        assert_eq!(repo.count(None, Some(8)).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn find_all_honors_sort_orders() {
        let repo = setup().await;
        repo.insert(NewFile {
            size_bytes: 300,
            ..new_file_named("a", "banana.txt", "document", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 100,
            ..new_file_named("b", "apple.txt", "document", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 200,
            ..new_file_named("c", "cherry.txt", "document", Some(7))
        })
        .await
        .unwrap();

        let ids = |rows: Vec<FileRow>| rows.into_iter().map(|f| f.stored_id).collect::<Vec<_>>();

        assert_eq!(
            ids(repo
                .find_all(10, 0, None, Some(7), SortOrder::SizeDesc)
                .await
                .unwrap()),
            vec!["a", "c", "b"]
        );
        assert_eq!(
            ids(repo
                .find_all(10, 0, None, Some(7), SortOrder::SizeAsc)
                .await
                .unwrap()),
            vec!["b", "c", "a"]
        );
        // 名称排序不区分大小写
        assert_eq!(
            ids(repo
                .find_all(10, 0, None, Some(7), SortOrder::NameAsc)
                .await
                .unwrap()),
            vec!["b", "a", "c"]
        );
        assert_eq!(
            ids(repo
                .find_all(10, 0, None, Some(7), SortOrder::NameDesc)
                .await
                .unwrap()),
            vec!["c", "a", "b"]
        );
    }

    #[tokio::test]
    async fn sort_combines_with_filter_and_search() {
        let repo = setup().await;
        repo.insert(NewFile {
            size_bytes: 10,
            ..new_file_named("img-s", "small.png", "image", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 90,
            ..new_file_named("img-l", "large.png", "image", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 50,
            ..new_file_named("doc-m", "mid.pdf", "document", Some(7))
        })
        .await
        .unwrap();

        // 筛选 + 排序：只看图片，按大小降序
        let images = repo
            .find_all(10, 0, Some("image"), Some(7), SortOrder::SizeDesc)
            .await
            .unwrap();
        assert_eq!(
            images
                .iter()
                .map(|f| f.stored_id.as_str())
                .collect::<Vec<_>>(),
            vec!["img-l", "img-s"]
        );

        // 搜索 + 排序（搜文件名后缀，命中两张图）
        let searched = repo
            .search_by_name(".png", Some(7), 10, 0, SortOrder::SizeAsc)
            .await
            .unwrap();
        assert_eq!(
            searched
                .iter()
                .map(|f| f.stored_id.as_str())
                .collect::<Vec<_>>(),
            vec!["img-s", "img-l"]
        );
    }

    #[tokio::test]
    async fn stats_aggregates_totals_and_categories() {
        let repo = setup().await;
        repo.insert(NewFile {
            size_bytes: 100,
            ..new_file_named("a", "a.png", "image", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 300,
            ..new_file_named("b", "b.png", "image", Some(7))
        })
        .await
        .unwrap();
        repo.insert(NewFile {
            size_bytes: 50,
            ..new_file_named("c", "c.pdf", "document", Some(7))
        })
        .await
        .unwrap();
        // 其他用户的文件不计入
        repo.insert(NewFile {
            size_bytes: 999,
            ..new_file_named("d", "d.bin", "other", Some(8))
        })
        .await
        .unwrap();

        let (count, bytes, rows) = repo.stats(Some(7)).await.unwrap();
        assert_eq!(count, 3);
        assert_eq!(bytes, 450);
        // 按占用降序
        assert_eq!(rows[0], ("image".to_string(), 2, 400));
        assert_eq!(rows[1], ("document".to_string(), 1, 50));

        // 不传 user_id 时统计全部
        let (all_count, all_bytes, _) = repo.stats(None).await.unwrap();
        assert_eq!(all_count, 4);
        assert_eq!(all_bytes, 1449);
    }

    // ── 更新 / 删除 ──

    #[tokio::test]
    async fn update_name_renames_and_missing_returns_none() {
        let repo = setup().await;
        insert(&repo, "ren-me").await;

        let updated = repo
            .update_name("ren-me", "renamed.png")
            .await
            .unwrap()
            .expect("file should exist");
        assert_eq!(updated.original_name, "renamed.png");
        assert!(repo.update_name("missing", "x").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn delete_removes_row_and_cascades_tag_rels_and_meta() {
        let repo = setup().await;
        let created = insert(&repo, "del-me").await;

        // 挂上标签与元信息
        let tag = repo.get_or_create_tag("笔记", 7).await.unwrap();
        repo.set_file_tags(created.id, &[tag.id]).await.unwrap();
        let mut meta = HashMap::new();
        meta.insert("pages".to_string(), "10".to_string());
        repo.set_file_meta(created.id, &meta).await.unwrap();

        let deleted = repo.delete("del-me").await.unwrap().unwrap();
        assert_eq!(deleted.id, created.id);
        assert!(repo.find_by_stored_id("del-me").await.unwrap().is_none());

        // 级联：file_tag_rel / file_meta 应被清空；file_tag 本身保留
        let rel_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM file_tag_rel WHERE file_id = ?")
                .bind(created.id)
                .fetch_one(&*repo.db)
                .await
                .unwrap();
        assert_eq!(rel_count, 0);
        let meta_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM file_meta WHERE file_id = ?")
                .bind(created.id)
                .fetch_one(&*repo.db)
                .await
                .unwrap();
        assert_eq!(meta_count, 0);
        assert_eq!(repo.get_user_tags(7).await.unwrap().len(), 1);
        assert!(repo.delete("del-me").await.unwrap().is_none());
    }

    // ── 标签 ──

    #[tokio::test]
    async fn get_or_create_tag_is_idempotent_and_user_scoped() {
        let repo = setup().await;
        let a = repo.get_or_create_tag("项目", 7).await.unwrap();
        let b = repo.get_or_create_tag("项目", 7).await.unwrap();
        assert_eq!(a.id, b.id);
        // 同名不同用户 → 不同标签
        let c = repo.get_or_create_tag("项目", 8).await.unwrap();
        assert_ne!(a.id, c.id);
        assert_eq!(repo.get_user_tags(7).await.unwrap().len(), 1);
        assert_eq!(repo.get_user_tags(8).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn set_file_tags_replaces_existing_and_reads_back() {
        let repo = setup().await;
        let created = insert(&repo, "tagged").await;
        let t1 = repo.get_or_create_tag("a", 7).await.unwrap();
        let t2 = repo.get_or_create_tag("b", 7).await.unwrap();

        repo.set_file_tags(created.id, &[t1.id]).await.unwrap();
        assert_eq!(repo.get_file_tags(created.id).await.unwrap().len(), 1);

        // 全量替换：从 [a] 变为 [a, b]
        repo.set_file_tags(created.id, &[t1.id, t2.id])
            .await
            .unwrap();
        let names: Vec<String> = repo
            .get_file_tags(created.id)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names.len(), 2);

        // 清空：传空数组
        repo.set_file_tags(created.id, &[]).await.unwrap();
        assert!(repo.get_file_tags(created.id).await.unwrap().is_empty());
    }

    // ── 标签管理（重命名/删除/合并） ──

    #[tokio::test]
    async fn get_user_tags_with_count_includes_zero() {
        let repo = setup().await;
        let f1 = insert(&repo, "f1").await;
        let used = repo.get_or_create_tag("在用", 7).await.unwrap();
        repo.get_or_create_tag("未用", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[used.id]).await.unwrap();

        let tags = repo.get_user_tags_with_count(7).await.unwrap();
        assert_eq!(tags.len(), 2);
        let by_name = |n: &str| tags.iter().find(|t| t.name == n).unwrap().count;
        assert_eq!(by_name("在用"), 1);
        assert_eq!(by_name("未用"), 0, "无关联文件的标签也应出现");
    }

    #[tokio::test]
    async fn rename_and_delete_tag() {
        let repo = setup().await;
        let f1 = insert(&repo, "f1").await;
        let tag = repo.get_or_create_tag("旧名", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[tag.id]).await.unwrap();

        repo.rename_tag(tag.id, "新名").await.unwrap();
        let names: Vec<String> = repo
            .get_file_tags(f1.id)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names, vec!["新名"]);

        // 重名冲突由唯一约束拒绝
        repo.get_or_create_tag("另一个", 7).await.unwrap();
        let other = repo.get_user_tags(7).await.unwrap();
        let another = other.iter().find(|t| t.name == "另一个").unwrap();
        let err = repo.rename_tag(another.id, "新名").await;
        assert!(err.is_err(), "同用户下重名应被唯一约束拒绝");

        // 删除标签：关联解除，文件保留
        repo.delete_tag(tag.id).await.unwrap();
        assert!(repo.get_file_tags(f1.id).await.unwrap().is_empty());
        assert!(repo.find_by_stored_id("f1").await.unwrap().is_some());
    }

    #[tokio::test]
    async fn merge_tags_moves_relations_and_removes_source() {
        let repo = setup().await;
        let f1 = insert(&repo, "f1").await;
        let f2 = insert(&repo, "f2").await;
        let from = repo.get_or_create_tag("来源", 7).await.unwrap();
        let to = repo.get_or_create_tag("目标", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[from.id]).await.unwrap();
        repo.set_file_tags(f2.id, &[to.id]).await.unwrap();

        repo.merge_tags(from.id, to.id).await.unwrap();

        // f1 现在带上目标标签；来源标签已删除
        let f1_tags: Vec<String> = repo
            .get_file_tags(f1.id)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(f1_tags, vec!["目标"]);
        assert_eq!(repo.get_user_tags(7).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn merge_tags_skips_duplicate_relations() {
        let repo = setup().await;
        let f1 = insert(&repo, "f1").await;
        let from = repo.get_or_create_tag("a", 7).await.unwrap();
        let to = repo.get_or_create_tag("b", 7).await.unwrap();
        // 同一文件同时带两个标签 → 合并后不应出现重复关联（主键冲突）
        repo.set_file_tags(f1.id, &[from.id, to.id]).await.unwrap();

        repo.merge_tags(from.id, to.id).await.unwrap();

        assert_eq!(repo.get_file_tags(f1.id).await.unwrap().len(), 1);
    }

    // ── 元信息 ──

    #[tokio::test]
    async fn set_file_meta_replaces_and_get_roundtrip() {
        let repo = setup().await;
        let created = insert(&repo, "meta-me").await;

        let mut meta = HashMap::new();
        meta.insert("author".to_string(), "张三".to_string());
        repo.set_file_meta(created.id, &meta).await.unwrap();

        let read = repo.get_file_meta(created.id).await.unwrap();
        assert_eq!(read.get("author").map(String::as_str), Some("张三"));

        // 全量替换：author 消失，pages 出现
        let mut meta2 = HashMap::new();
        meta2.insert("pages".to_string(), "3".to_string());
        repo.set_file_meta(created.id, &meta2).await.unwrap();
        let read2 = repo.get_file_meta(created.id).await.unwrap();
        assert!(!read2.contains_key("author"));
        assert_eq!(read2.get("pages").map(String::as_str), Some("3"));
    }

    // ── 内容引用统计 ──

    #[tokio::test]
    async fn count_content_references_across_content_tables() {
        let repo = setup().await;
        insert(&repo, "abc123photo").await;

        // 同一 stored_id 出现在四张内容表中，应统计为 4 处引用
        for sql in [
            "INSERT INTO card (content) VALUES ('![x](/api/file/abc123photo/data/a.png)')",
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

    // ── 标签筛选（含 tag+q 组合） ──

    #[tokio::test]
    async fn find_by_tag_filters_and_combines_with_name_query() {
        let repo = setup().await;
        let f1 = repo
            .insert(new_file_named("rep-a", "季度报告.md", "document", Some(7)))
            .await
            .unwrap();
        repo.insert(new_file_named("pho-b", "风景照.png", "image", Some(7)))
            .await
            .unwrap();
        let tag = repo.get_or_create_tag("文档", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[tag.id]).await.unwrap();

        // 仅按 tag
        let hits = repo
            .find_by_tag("文档", 7, None, 10, 0, SortOrder::default())
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].stored_id, "rep-a");

        // tag + 文件名 q 组合：不匹配的 q 应过滤掉
        let no_hits = repo
            .find_by_tag("文档", 7, Some("zzz"), 10, 0, SortOrder::default())
            .await
            .unwrap();
        assert!(no_hits.is_empty());
        let one_hit = repo
            .find_by_tag("文档", 7, Some("报告"), 10, 0, SortOrder::default())
            .await
            .unwrap();
        assert_eq!(one_hit.len(), 1);
        assert_eq!(one_hit[0].stored_id, "rep-a");

        // 其他用户的同名标签不干扰
        repo.get_or_create_tag("文档", 8).await.unwrap();
        assert_eq!(
            repo.find_by_tag("文档", 8, None, 10, 0, SortOrder::default())
                .await
                .unwrap()
                .len(),
            0
        );
    }

    #[tokio::test]
    async fn count_by_tag_with_and_without_name_query() {
        let repo = setup().await;
        let f1 = repo
            .insert(new_file_named("alp", "alpha.txt", "document", Some(7)))
            .await
            .unwrap();
        let f2 = repo
            .insert(new_file_named("bet", "beta.txt", "document", Some(7)))
            .await
            .unwrap();
        let tag = repo.get_or_create_tag("杂项", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[tag.id]).await.unwrap();
        repo.set_file_tags(f2.id, &[tag.id]).await.unwrap();

        assert_eq!(repo.count_by_tag("杂项", 7, None).await.unwrap(), 2);
        assert_eq!(repo.count_by_tag("杂项", 7, Some("alp")).await.unwrap(), 1);
        assert_eq!(repo.count_by_tag("杂项", 7, Some("none")).await.unwrap(), 0);
    }

    #[tokio::test]
    async fn get_tags_for_files_maps_per_file() {
        let repo = setup().await;
        let f1 = insert(&repo, "f1").await;
        let f2 = insert(&repo, "f2").await;
        let f3 = insert(&repo, "f3").await; // 无标签
        let t1 = repo.get_or_create_tag("a", 7).await.unwrap();
        let t2 = repo.get_or_create_tag("b", 7).await.unwrap();
        repo.set_file_tags(f1.id, &[t1.id, t2.id]).await.unwrap();
        repo.set_file_tags(f2.id, &[t2.id]).await.unwrap();

        let map = repo
            .get_tags_for_files(&[f1.id, f2.id, f3.id])
            .await
            .unwrap();
        assert_eq!(map.get(&f1.id).map(Vec::len), Some(2));
        assert_eq!(map.get(&f2.id).map(Vec::len), Some(1));
        assert!(!map.contains_key(&f3.id), "无标签文件不应出现在结果中");
        // 空输入短路（不产生非法 SQL）
        assert!(repo.get_tags_for_files(&[]).await.unwrap().is_empty());
    }

    // ── 文件名搜索 ──

    #[tokio::test]
    async fn search_by_name_matches_like_and_scopes_user() {
        let repo = setup().await;
        repo.insert(new_file_named("b1", "预算表.xlsx", "document", Some(7)))
            .await
            .unwrap();
        repo.insert(new_file_named("p1", "照片.png", "image", Some(7)))
            .await
            .unwrap();
        repo.insert(new_file_named("o1", "other-file.bin", "image", Some(8)))
            .await
            .unwrap();

        let hits = repo
            .search_by_name("预算", Some(7), 10, 0, SortOrder::default())
            .await
            .unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].stored_id, "b1");

        let all = repo
            .search_by_name("", Some(7), 10, 0, SortOrder::default())
            .await
            .unwrap();
        assert_eq!(all.len(), 2);

        assert_eq!(repo.count_by_name("预算", Some(7)).await.unwrap(), 1);
        assert_eq!(repo.count_by_name("", Some(7)).await.unwrap(), 2);
        // 用户隔离
        assert_eq!(
            repo.search_by_name("file", Some(8), 10, 0, SortOrder::default())
                .await
                .unwrap()
                .len(),
            1
        );
        // LIKE 通配符转义：搜索 "%" 应作为字面字符（0 命中），而非匹配全部
        assert_eq!(
            repo.search_by_name("%", Some(7), 10, 0, SortOrder::default())
                .await
                .unwrap()
                .len(),
            0
        );
        assert_eq!(
            repo.search_by_name("_", Some(7), 10, 0, SortOrder::default())
                .await
                .unwrap()
                .len(),
            0
        );
    }
}
