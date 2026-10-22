//! FTS5 全文索引：清单 + 虚拟表/触发器生成 + 同步。
//!
//! **定义只有这一份**：新库（`create_tables`）与结构同步（`reconcile`）都调这里的生成器 ——
//! 分几份写迟早漂移，而漂移的后果是"新库搜不到、旧库能搜到"这类只在一侧复现的问题。

use sqlx::SqliteConnection;

use super::{columns_exist, same_ddl, stored_sql};

/// 一个 FTS 索引的全部对象：虚表 + 三个同步触发器（DDL 文本只在这里生成）
pub(crate) struct FtsObjects {
    pub(crate) table_name: String,
    pub(crate) table_ddl: String,
    pub(crate) triggers: Vec<(String, String)>,
}

/// 建 FTS 结构（幂等）+ 从源表 `rebuild` 回填索引。基线用。
///
/// 只建结构、不重建索引这句是给迁移链说的；这里连 rebuild 一起做 —— 新库没有数据，
/// rebuild 是空转，老库（`create_tables` 也会在老库上跑）则有数据要回填。
pub(crate) async fn create_fts_indexes(conn: &mut SqliteConnection) -> Result<(), sqlx::Error> {
    let objects = applicable(conn).await?;
    for objects in &objects {
        create_table(conn, objects).await?;
        create_triggers(conn, objects).await?;
    }
    rebuild_all(conn, &objects).await
}

/// `reconcile` 用：虚表缺则建、定义变了则整组重建并回填；**触发器每次都重铺**。
///
/// 触发器为什么不留着：AFTER 触发器按**创建顺序**触发，而时间归一化触发器（内含 UPDATE）
/// 必须早于 FTS 的 `_au`（delete + 重插）—— 顺序反了会在 external content 的 FTS5 上撞出
/// `database disk image is malformed`（见 `schema::create_tables` 的注释）。老库上 FTS
/// 触发器早就存在，第 ⑤ 阶段补/换的时间触发器只会排在它们后面 —— 所以这里把 FTS 触发器
/// 全部拆掉重建，顺序由阶段结构（⑤ 在 ⑥ 之前）保证，而不是碰运气。代价是几十条
/// DDL，只在版本升级时发生一次；虚拟表本身不动，索引不用重刷。
pub(crate) async fn sync(conn: &mut SqliteConnection) -> Result<Vec<String>, sqlx::Error> {
    let mut actions = Vec::new();
    for objects in applicable(conn).await? {
        let stored = stored_sql(conn, &objects.table_name).await?;
        match stored {
            Some(stored) if same_ddl(&objects.table_ddl, &stored) => {
                drop_triggers(conn, &objects).await?;
                create_triggers(conn, &objects).await?;
            }
            // 虚表定义不符（或压根没有）：先拆触发器再拆表，重建后回填
            // —— 顺序照抄 v14：留着引用旧表的触发器会让 DROP TABLE 之后的状态不可用
            Some(_) => {
                drop_objects(conn, &objects).await?;
                create_table(conn, &objects).await?;
                create_triggers(conn, &objects).await?;
                rebuild(conn, &objects.table_name).await?;
                actions.push(format!("重建 FTS {}", objects.table_name));
            }
            None => {
                create_table(conn, &objects).await?;
                create_triggers(conn, &objects).await?;
                rebuild(conn, &objects.table_name).await?;
                actions.push(format!("建 FTS {}", objects.table_name));
            }
        }
    }
    Ok(actions)
}

async fn create_table(
    conn: &mut SqliteConnection,
    objects: &FtsObjects,
) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(objects.table_ddl.clone()))
        .execute(&mut *conn)
        .await?;
    Ok(())
}

async fn create_triggers(
    conn: &mut SqliteConnection,
    objects: &FtsObjects,
) -> Result<(), sqlx::Error> {
    for (_, ddl) in &objects.triggers {
        sqlx::query(sqlx::AssertSqlSafe(ddl.clone()))
            .execute(&mut *conn)
            .await?;
    }
    Ok(())
}

async fn drop_triggers(
    conn: &mut SqliteConnection,
    objects: &FtsObjects,
) -> Result<(), sqlx::Error> {
    for (name, _) in &objects.triggers {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "DROP TRIGGER IF EXISTS {name}"
        )))
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}

/// 拆掉一个 FTS 索引（触发器先删，见 `sync` 里的说明）
async fn drop_objects(
    conn: &mut SqliteConnection,
    objects: &FtsObjects,
) -> Result<(), sqlx::Error> {
    drop_triggers(conn, objects).await?;
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "DROP TABLE IF EXISTS {}",
        objects.table_name
    )))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// 从源表回填索引
async fn rebuild(conn: &mut SqliteConnection, fts: &str) -> Result<(), sqlx::Error> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "INSERT INTO {fts}({fts}) VALUES('rebuild')"
    )))
    .execute(&mut *conn)
    .await?;
    Ok(())
}

async fn rebuild_all(
    conn: &mut SqliteConnection,
    objects: &[FtsObjects],
) -> Result<(), sqlx::Error> {
    for objects in objects {
        rebuild(conn, &objects.table_name).await?;
    }
    Ok(())
}

/// 源表列齐全的 FTS 索引（缺列的跳过 —— SQLite 建虚表/触发器时就解析列名）。
///
/// 注意 `create_tables` 会先把所有缺的表建齐，`reconcile` 也会先补列，
/// 所以"源表存在但缺索引列"在正常流程里不会出现，守卫是兜底。
pub(crate) async fn applicable(
    conn: &mut SqliteConnection,
) -> Result<Vec<FtsObjects>, sqlx::Error> {
    let mut out = Vec::new();
    for (fts, src, rowid, cols, prefix) in FTS_SPECS {
        let mut wanted = vec![*rowid];
        wanted.extend_from_slice(cols);
        if !columns_exist(conn, src, &wanted).await? {
            continue;
        }

        let col_def = cols.join(", ");
        let ins_new = cols
            .iter()
            .map(|c| format!("new.{c}"))
            .collect::<Vec<_>>()
            .join(", ");
        let del_old = cols
            .iter()
            .map(|c| format!("old.{c}"))
            .collect::<Vec<_>>()
            .join(", ");

        let table_ddl = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS {fts} USING fts5({col_def}, content='{src}', content_rowid='{rowid}', tokenize='trigram')"
        );

        let mut triggers = Vec::new();
        for (suffix, body) in [
            (
                "ai",
                format!(
                    "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ai AFTER INSERT ON {src} BEGIN
               INSERT INTO {fts}(rowid, {col_def}) VALUES (new.{rowid}, {ins_new});
             END"
                ),
            ),
            (
                "ad",
                format!(
                    "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_ad AFTER DELETE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {col_def}) VALUES ('delete', old.{rowid}, {del_old});
             END"
                ),
            ),
            (
                "au",
                format!(
                    "CREATE TRIGGER IF NOT EXISTS {prefix}_fts_au AFTER UPDATE ON {src} BEGIN
               INSERT INTO {fts}({fts}, rowid, {col_def}) VALUES ('delete', old.{rowid}, {del_old});
               INSERT INTO {fts}(rowid, {col_def}) VALUES (new.{rowid}, {ins_new});
             END"
                ),
            ),
        ] {
            triggers.push((format!("{prefix}_fts_{suffix}"), body));
        }

        out.push(FtsObjects {
            table_name: (*fts).to_string(),
            table_ddl,
            triggers,
        });
    }
    Ok(out)
}

/// 全文索引清单：(fts 表, 源表, rowid 列, 索引列, 触发器前缀)
///
/// 基线、v12（首建）、v14（trigram 重建）共用这一份。
pub(crate) const FTS_SPECS: &[(&str, &str, &str, &[&str], &str)] = &[
    ("card_fts", "card", "id", &["content"], "card"),
    ("task_fts", "task", "id", &["title", "description"], "task"),
    (
        "bookmark_fts",
        "bookmark",
        "id",
        &["title", "url", "description"],
        "bookmark",
    ),
    ("onto_fts", "onto", "id", &["name", "description"], "onto"),
    (
        "text_note_fts",
        "text_note",
        "id",
        &["name", "content"],
        "text_note",
    ),
    (
        "reading_article_fts",
        "reading_article",
        "id",
        &["title", "content"],
        "reading_article",
    ),
    (
        "conv_titles_fts",
        "conv_titles",
        "id",
        &["title"],
        "conv_titles",
    ),
    (
        "articles_fts",
        "articles",
        "id",
        &["title", "content"],
        "articles",
    ),
    (
        "chat_node_fts",
        "chat_node",
        "id",
        &["content"],
        "chat_node",
    ),
    ("chunk_fts", "chunk", "id", &["content"], "chunk"),
];
