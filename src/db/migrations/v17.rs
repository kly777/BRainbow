//! v17：content_hash 改为唯一索引，堵住并发上传绕过去重的竞态。
//!
//! v16 建的 `(user_id, content_hash)` 普通索引有两个问题：
//! 1. 去重已是全局语义（查询只按 content_hash），复合索引前缀不匹配、用不上；
//! 2. 没有唯一约束——两个请求同时上传同一内容时，"先查后插"各自未命中，
//!    结果插入两条记录、两份磁盘文件。
//!
//! 迁移步骤：
//! 1. 清理存量重复哈希（保留最早一条，其余置 NULL 退出去重集合，不删数据）
//! 2. 删除旧复合索引
//! 3. 建 content_hash 上的部分唯一索引（NULL 不参与，SQLite 允许并列 NULL）

use sqlx::SqliteConnection;

use super::super::helpers::migration_failed;

pub async fn migrate(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    // 1. 重复哈希的非最早记录清空哈希（保留记录与文件，只是不再参与去重）
    sqlx::query(
        "UPDATE file SET content_hash = NULL
         WHERE content_hash IS NOT NULL
           AND id NOT IN (
               SELECT MIN(id) FROM file WHERE content_hash IS NOT NULL GROUP BY content_hash
           )",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v17 清理重复 content_hash", &e))?;

    // 2. 旧复合索引（前缀为 user_id，全局查询用不上）
    sqlx::query("DROP INDEX IF EXISTS idx_file_content_hash")
        .execute(&mut *conn)
        .await
        .map_err(|e| migration_failed("v17 删除旧 content_hash 索引", &e))?;

    // 3. 部分唯一索引：仅约束非 NULL 值
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_file_content_hash_unique
         ON file(content_hash) WHERE content_hash IS NOT NULL",
    )
    .execute(&mut *conn)
    .await
    .map_err(|e| migration_failed("v17 创建 content_hash 唯一索引", &e))?;

    Ok(())
}
