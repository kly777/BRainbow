//! v18：文件可见性模型改为「默认公开、可单独设为私密」，标签改为全局共享。
//!
//! 背景：此前的隔离模型是"每个用户只看自己的文件"（列表按 `user_id` 过滤），
//! 但详情/内容路由并不校验归属 —— 语义不一致。现改为：
//! - 所有文件默认公开（`is_private = 0`），任何人可见；
//! - 单个文件可设为私密（`is_private = 1`），仅上传者可见（内容路由要求认证）；
//! - 标签随之全局共享：同名标签只保留一条，关联合并到最早的那条。
//!
//! 迁移步骤：
//! 1. `file` 增加 `is_private` 列（默认 0 = 公开，存量文件因此全部保持可见）
//! 2. 合并跨用户的同名标签（关联迁移到最早一条，删除多余标签）
//! 3. 建全局唯一索引 `idx_file_tag_name_unique`
//! 4. 索引整理：新增可见性索引，删除被 UNIQUE 约束索引覆盖的 `idx_file_stored_id`
//!
//! 注：`file_category` 的生成列改造在 v19 完成 —— SQLite 虽不能把已有列改成生成列，
//! 但 `ALTER TABLE ADD COLUMN` 可以添加 VIRTUAL 生成列（可建索引），因此无需重建表、
//! 也无需关闭外键。

use sqlx::SqliteConnection;

use super::super::helpers::{column_exists_on, migration_failed};

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 1. 可见性列：默认公开，存量文件全部保持可见。
    //    新库的基线已含该列（迁移必须幂等：列已存在则跳过）
    if !column_exists_on(conn, "file", "is_private")
        .await
        .map_err(|e| migration_failed("v18 检查 file.is_private", &e))?
    {
        sqlx::query("ALTER TABLE file ADD COLUMN is_private INTEGER NOT NULL DEFAULT 0")
            .execute(&mut *conn)
            .await
            .map_err(|e| migration_failed("v18 添加 file.is_private", &e))?;
    }

    // 2a. 同名标签的关联合并到最早的那条标签上
    sqlx::query(
        "INSERT OR IGNORE INTO file_tag_rel (file_id, tag_id)
         SELECT r.file_id, (SELECT MIN(t2.id) FROM file_tag t2 WHERE t2.name = t.name)
           FROM file_tag_rel r
           JOIN file_tag t ON t.id = r.tag_id
          WHERE r.tag_id <> (SELECT MIN(t2.id) FROM file_tag t2 WHERE t2.name = t.name)",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v18 合并同名标签关联", &e))?;

    // 2b. 清掉指向"非最早标签"的关联与这些多余标签本身
    sqlx::query(
        "DELETE FROM file_tag_rel
          WHERE tag_id NOT IN (SELECT MIN(id) FROM file_tag GROUP BY name)",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v18 清理多余标签关联", &e))?;

    sqlx::query("DELETE FROM file_tag WHERE id NOT IN (SELECT MIN(id) FROM file_tag GROUP BY name)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v18 清理多余标签", &e))?;

    // 3. 全局唯一：同名标签只允许一条（旧库原有的 UNIQUE(name, user_id) 保留，
    //    它是本约束的弱化版，不冲突）
    sqlx::query("CREATE UNIQUE INDEX IF NOT EXISTS idx_file_tag_name_unique ON file_tag(name)")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v18 建标签全局唯一索引", &e))?;

    // 4a. 可见性索引：公开列表（绝大多数查询）走它
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_file_visibility ON file(is_private, created_at DESC)",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v18 建可见性索引", &e))?;

    // 4b. stored_id 上的 UNIQUE 约束已隐含索引，这条件索引是冗余的
    sqlx::query("DROP INDEX IF EXISTS idx_file_stored_id")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v18 删除冗余 stored_id 索引", &e))?;

    Ok(())
}
