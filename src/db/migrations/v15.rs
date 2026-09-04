//! v15：创建通用文件服务，删除旧 media 表。
//!
//! 新增 file、file_tag、file_tag_rel、file_meta 四张表。
//! 删除旧 media 表及其索引。

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 1. 删除旧 media 表
    sqlx::query("DROP INDEX IF EXISTS idx_media_stored_id")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 删除 idx_media_stored_id", &e))?;

    sqlx::query("DROP INDEX IF EXISTS idx_media_type_created")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 删除 idx_media_type_created", &e))?;

    sqlx::query("DROP TABLE IF EXISTS media")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 删除 media", &e))?;

    // 2. 创建 file 主表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file (
            id              INTEGER PRIMARY KEY,
            stored_id       TEXT    NOT NULL UNIQUE,
            original_name   TEXT    NOT NULL,
            mime_type       TEXT    NOT NULL,
            file_category   TEXT    NOT NULL DEFAULT 'other',
            size_bytes      INTEGER NOT NULL DEFAULT 0,
            width           INTEGER,
            height          INTEGER,
            duration_ms     INTEGER,
            user_id         INTEGER,
            created_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            updated_at      TIMESTAMP DEFAULT (strftime('%Y-%m-%dT%H:%M:%S+00:00', 'now')),
            FOREIGN KEY (user_id) REFERENCES user(id)
        )
        "#,
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v15 创建 file", &e))?;

    // 3. 创建索引
    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_created ON file(created_at DESC)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 创建 idx_file_created", &e))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_category ON file(file_category, created_at DESC)",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v15 创建 idx_file_category", &e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_stored_id ON file(stored_id)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 创建 idx_file_stored_id", &e))?;

    // 4. 创建 file_tag 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_tag (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            name    TEXT    NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES user(id),
            UNIQUE(name, user_id)
        )
        "#,
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v15 创建 file_tag", &e))?;

    // 5. 创建 file_tag_rel 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_tag_rel (
            file_id INTEGER NOT NULL,
            tag_id  INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id)  REFERENCES file_tag(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v15 创建 file_tag_rel", &e))?;

    sqlx::query("CREATE INDEX IF NOT EXISTS idx_file_tag_rel_tag ON file_tag_rel(tag_id)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v15 创建 idx_file_tag_rel_tag", &e))?;

    // 6. 创建 file_meta 表
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS file_meta (
            file_id INTEGER NOT NULL,
            key     TEXT    NOT NULL,
            value   TEXT    NOT NULL,
            PRIMARY KEY (file_id, key),
            FOREIGN KEY (file_id) REFERENCES file(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v15 创建 file_meta", &e))?;

    Ok(())
}
