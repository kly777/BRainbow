//! 版本化的数据修复：**幂等**，且要能从任意旧形状跑 —— `reconcile` 不重放历史。
//!
//! 每条对应一次历史迁移（注释标出版本），只对 `版本 > 库版本` 的库跑一次；
//! 结构（表/列/索引/触发器）由声明补齐，这里只管**数据**。
//!
//! 前置条件由 `apply::reconcile` 的阶段顺序保证：跑到第 ③ 步时，声明里的表与列都已就位。
//!
//! **一个例外**：时间戳规范化无条件跑（不进 [`REPAIRS`] 表）。它的正确性依赖一份会增长的
//! 清单（`TIME_COLUMNS`），按版本门控就意味着"清单扩了、忘了抬门槛"会静默漏掉一类列
//! （`file.updated_at` 就是这么漏了 11 行）。代价是三十来条 UPDATE，只在版本升级时发生。

use sqlx::SqliteConnection;

use super::TIME_COLUMNS;

/// 修复清单：加一条 = 写一个幂等函数 + 在这里加一行（宏生成清单与分发，见下）。
macro_rules! repairs {
    ($($version:literal => $name:ident, $what:literal;)+) => {
        /// 修复清单：(引入版本, 说明)。升序即执行顺序。
        pub(crate) const REPAIRS: &[(i64, &str)] = &[$(($version, $what)),+];

        /// 跑 `版本 > from_version` 的那些修复，返回做过的动作（供日志）。
        pub(crate) async fn run(
            conn: &mut SqliteConnection,
            from_version: i64,
        ) -> Result<Vec<String>, sqlx::Error> {
            let mut done = Vec::new();
            for &(version, what) in REPAIRS {
                if version <= from_version {
                    continue;
                }
                match version {
                    $($version => $name(conn).await?,)+
                    _ => continue,
                }
                done.push(format!("{what}（v{version}）"));
            }
            Ok(done)
        }
    };
}

repairs! {
    17 => dedupe_content_hash, "content_hash 去重（保留最早一条）";
    18 => merge_duplicate_tags, "同名标签合并到最早一条";
    20 => claim_orphan_rows, "无主行认领给 admin";
    23 => reset_pdf_text_content, "PDF 正文置空待重抽（换了抽取器）";
}

/// v8 引入、v21 扩展到 `file`：把存量时间列统一成 `+00:00` 规范形态。
///
/// 无条件跑（理由见模块注释）。走 [`TIME_COLUMNS`] —— 与归一化触发器同一份清单，
/// 触发器覆盖不到的列这里同样覆盖不到（完整性由
/// `db::tests::time_columns_cover_every_timestamp_column` 钉住）。
pub(crate) async fn normalize_timestamps(
    conn: &mut SqliteConnection,
) -> Result<Vec<String>, sqlx::Error> {
    let own_suffix = "+00:00";
    let other_suffix = "Z";
    let mut affected = 0;

    for (table, _pk, columns) in TIME_COLUMNS {
        for column in *columns {
            // 表名/列名取自编译期清单，无注入
            let sql = format!(
                "UPDATE {table} SET {column} = CASE \
                 WHEN {column} GLOB '????-??-??T??:??:??*{own_suffix}' THEN {column} \
                 WHEN {column} GLOB '????-??-??T??:??:??*{other_suffix}' \
                   THEN replace({column}, '{other_suffix}', '{own_suffix}') \
                 ELSE strftime('%Y-%m-%dT%H:%M:%S{own_suffix}', {column}) END \
                 WHERE {column} IS NOT NULL AND {column} <> '' \
                 AND {column} GLOB '????-??-??*' \
                 AND {column} NOT GLOB '????-??-??T??:??:??*{own_suffix}'"
            );
            affected += sqlx::query(sqlx::AssertSqlSafe(sql))
                .execute(&mut *conn)
                .await?
                .rows_affected();
        }
    }

    Ok(if affected > 0 {
        vec![format!("时间戳规范化 {affected} 行")]
    } else {
        Vec::new()
    })
}

/// v17：`content_hash` 去重 —— 同名哈希只保留最早一条，其余置 NULL（不删数据）。
///
/// 必须在建唯一索引**之前**跑：索引建不上去（`idx_file_content_hash_unique`）。
async fn dedupe_content_hash(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE file SET content_hash = NULL
         WHERE content_hash IS NOT NULL
           AND id NOT IN (
               SELECT MIN(id) FROM file WHERE content_hash IS NOT NULL GROUP BY content_hash
           )",
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// v18：同名标签合并到最早一条 —— 先把关联搬过去，再清掉多余的关联与标签本身。
///
/// `file_tag` 的唯一约束从 `(name, user_id)` 收紧成全局 `name` 的必经步骤。
async fn merge_duplicate_tags(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT OR IGNORE INTO file_tag_rel (file_id, tag_id)
         SELECT r.file_id, (SELECT MIN(t2.id) FROM file_tag t2 WHERE t2.name = t.name)
           FROM file_tag_rel r
           JOIN file_tag t ON t.id = r.tag_id
          WHERE r.tag_id <> (SELECT MIN(t2.id) FROM file_tag t2 WHERE t2.name = t.name)",
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "DELETE FROM file_tag_rel
          WHERE tag_id NOT IN (SELECT MIN(id) FROM file_tag GROUP BY name)",
    )
    .execute(&mut *conn)
    .await?;

    sqlx::query(
        "DELETE FROM file_tag WHERE id NOT IN (SELECT MIN(id) FROM file_tag GROUP BY name)",
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// v23：把 PDF 行的正文置空，交给启动回填**用新抽取器重抽**。
///
/// 背景：正文抽取器从 `pdf-extract` 换成了 `pdf_oxide`（选型见
/// `modules/file/extract.rs`）。旧库里的 PDF 正文是上一个库留下的 —— 它映射不到的字形
/// 整段丢（实测同一份论文只抽到新库的一半文字），而"`text_content` 非 NULL 就不再抽"
/// 的回填策略不会自己更新它们。
///
/// 为什么放在这里而不是应用层：这是"换了一次抽取器"的历史动作，只该发生一次；
/// 数据修复正是这套版本化修复机制的用途（与 v20 认领无主行同类）。
///
/// 代价是重抽一遍（后台、一次性）：一行 1312 页的教材约 94 秒。幂等：再跑一遍只会
/// 把已经重抽好的又置空一次，回填再补回来（收敛，不丢数据）。
async fn reset_pdf_text_content(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE file SET text_content = NULL
          WHERE mime_type = 'application/pdf' AND text_content IS NOT NULL",
    )
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 认领范围：这些表的 NULL 行归当前 admin。
///
/// 逐表理由（都是"有该列、且 NULL 表示无主"的表）：
/// - `card` / `task` / `time_window`：基线就带 `user_id`，但早期 handler 不提取
///   Claims，历史行全是 NULL；
/// - `file`：匿名上传的老文件（未认证，`user_id` 留空）；
/// - 其余是 v11 补列的那批（mem 家族、bookmark、reading、conv、text、onto、sign）；
/// - `ai_settings`：NULL 行谁都读不到（读取一律 `WHERE user_id = ?`），认领后归 admin。
///
/// **不碰 `api_key`**：那里的 `user_id IS NULL` 是**有意义的既有语义**（无主 key，
/// 校验时映射成 `sub: -1`）。回填等于把一把无主 key 升格成 admin 身份，是提权不是清理。
const CLAIM_TABLES: &[&str] = &[
    "card",
    "task",
    "time_window",
    "file",
    "chunk",
    "mem",
    "onto",
    "signifier_signified",
    "text_note",
    "bookmark",
    "bookmark_tag",
    "reading_article",
    "reading_user_word",
    "conv_titles",
    "articles",
    "ai_settings",
];

/// v20：把 `user_id IS NULL` 的历史行归属到当前（最早的）admin。
///
/// 还没人注册（全新库）就整段跳过 —— 认领是数据治理动作，不该让启动失败。
/// 幂等：`UPDATE … WHERE user_id IS NULL` 第二次执行为 0 行。
async fn claim_orphan_rows(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    let admin_id: Option<i64> =
        sqlx::query_scalar("SELECT id FROM user WHERE role = 'admin' ORDER BY id LIMIT 1")
            .fetch_optional(&mut *conn)
            .await?;
    let Some(admin_id) = admin_id else {
        return Ok(());
    };

    for table in CLAIM_TABLES {
        // 表名是编译期常量，无注入
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "UPDATE {table} SET user_id = ?1 WHERE user_id IS NULL"
        )))
        .bind(admin_id)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
