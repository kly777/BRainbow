#![allow(clippy::unwrap_used)]
use super::*;
use crate::modules::db_viewer::handler::{TableFilter, TableReadOptions};
use sqlx::SqlitePool;

async fn setup() -> DBRepo {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query("CREATE TABLE test_table (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO test_table VALUES (1, 'alice'), (2, 'bob')")
        .execute(&*pool)
        .await
        .unwrap();
    DBRepo { pool }
}

#[tokio::test]
async fn get_table_names() {
    let repo = setup().await;
    let names = repo.get_table_names().await.unwrap();
    assert!(names.contains(&"test_table".to_string()));
}

#[tokio::test]
async fn get_table_data() {
    let repo = setup().await;
    let data = repo
        .get_table_data("test_table", 10, 0, &TableReadOptions::default())
        .await
        .unwrap();
    assert_eq!(data.header.len(), 2);
    assert_eq!(data.rows.len(), 2);
    assert_eq!(data.total, 2);
    assert!(data.refs.is_empty());
}

#[tokio::test]
async fn get_table_data_paginated() {
    let repo = setup().await;
    let data = repo
        .get_table_data("test_table", 1, 1, &TableReadOptions::default())
        .await
        .unwrap();
    assert_eq!(data.rows.len(), 1);
    assert_eq!(data.total, 2);
}

#[tokio::test]
async fn get_table_data_sorts_and_filters() {
    let repo = setup().await;
    let desc = repo
        .get_table_data(
            "test_table",
            10,
            0,
            &TableReadOptions {
                sort_col: Some("name".into()),
                sort_desc: true,
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(desc.rows[0][1], serde_json::json!("bob"));

    let filtered = repo
        .get_table_data(
            "test_table",
            10,
            0,
            &TableReadOptions {
                search_col: Some("name".into()),
                search: Some("b".into()),
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.rows[0][1], serde_json::json!("bob"));
}

#[tokio::test]
async fn get_table_data_applies_multiple_filters() {
    let repo = setup().await;
    let filtered = repo
        .get_table_data(
            "test_table",
            10,
            0,
            &TableReadOptions {
                filters: vec![
                    TableFilter {
                        column: "id".into(),
                        op: FilterOp::Gt,
                        value: Some("1".into()),
                    },
                    TableFilter {
                        column: "name".into(),
                        op: FilterOp::Prefix,
                        value: Some("b".into()),
                    },
                ],
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.rows[0][1], serde_json::json!("bob"));

    let none = repo
        .get_table_data(
            "test_table",
            10,
            0,
            &TableReadOptions {
                filters: vec![
                    TableFilter {
                        column: "id".into(),
                        op: FilterOp::Eq,
                        value: Some("1".into()),
                    },
                    TableFilter {
                        column: "name".into(),
                        op: FilterOp::Ne,
                        value: Some("alice".into()),
                    },
                ],
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(none.total, 0);
}

#[tokio::test]
async fn get_table_data_filters_null_and_not_null() {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query("CREATE TABLE t (id INTEGER PRIMARY KEY, note TEXT)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO t VALUES (1, 'x'), (2, NULL)")
        .execute(&*pool)
        .await
        .unwrap();
    let repo = DBRepo { pool };

    let nulls = repo
        .get_table_data(
            "t",
            10,
            0,
            &TableReadOptions {
                filters: vec![TableFilter {
                    column: "note".into(),
                    op: FilterOp::IsNull,
                    value: None,
                }],
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(nulls.total, 1);
    assert_eq!(nulls.rows[0][0], serde_json::json!(2));

    let not_nulls = repo
        .get_table_data(
            "t",
            10,
            0,
            &TableReadOptions {
                filters: vec![TableFilter {
                    column: "note".into(),
                    op: FilterOp::NotNull,
                    value: None,
                }],
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(not_nulls.total, 1);
    assert_eq!(not_nulls.rows[0][0], serde_json::json!(1));
}

#[tokio::test]
async fn table_not_found() {
    let repo = setup().await;
    let result = repo
        .get_table_data("nonexistent", 10, 0, &TableReadOptions::default())
        .await;
    assert!(result.is_err());
}

#[tokio::test]
async fn get_table_data_decodes_real_and_integer_columns() {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query(
        "CREATE TABLE typed_table (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                score REAL NOT NULL,
                count INTEGER NOT NULL,
                label TEXT
            )",
    )
    .execute(&*pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO typed_table (score, count, label) VALUES (0.5, 3, 'x')")
        .execute(&*pool)
        .await
        .unwrap();
    let repo = DBRepo { pool };

    let data = repo
        .get_table_data("typed_table", 10, 0, &TableReadOptions::default())
        .await
        .unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.rows[0][0], serde_json::json!(1));
    assert_eq!(data.rows[0][1], serde_json::json!(0.5));
    assert_eq!(data.rows[0][2], serde_json::json!(3));
    assert_eq!(data.rows[0][3], serde_json::json!("x"));

    // AUTOINCREMENT 表会生成 sqlite_sequence，其 seq 列为 INTEGER
    let seq = repo
        .get_table_data("sqlite_sequence", 10, 0, &TableReadOptions::default())
        .await
        .unwrap();
    assert_eq!(seq.rows.len(), 1);
    assert_eq!(seq.rows[0][1], serde_json::json!(1));
}

#[tokio::test]
async fn detects_ref_by_foreign_key_and_column_name() {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query("CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO author VALUES (1, 'Ada Lovelace')")
        .execute(&*pool)
        .await
        .unwrap();
    // owner 表只用于启发式识别（owner_id 无实际外键声明）
    sqlx::query("CREATE TABLE owner (id INTEGER PRIMARY KEY)")
        .execute(&*pool)
        .await
        .unwrap();
    // book.author_id 带实际外键；book.owner_id 无外键但目标表 author 存在
    sqlx::query(
        "CREATE TABLE book (
                id INTEGER PRIMARY KEY,
                author_id INTEGER REFERENCES author(id),
                owner_id INTEGER
            )",
    )
    .execute(&*pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO book VALUES (1, 1, 1)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("CREATE TABLE not_a_table (id INTEGER PRIMARY KEY)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE thing (id INTEGER PRIMARY KEY, missing_table_id INTEGER, author_id INTEGER)",
    )
    .execute(&*pool)
    .await
    .unwrap();

    let repo = DBRepo { pool };
    let book = repo
        .get_table_data("book", 10, 0, &TableReadOptions::default())
        .await
        .unwrap();
    let author = book.header.iter().find(|c| c.name == "author_id").unwrap();
    assert_eq!(author.ref_table.as_deref(), Some("author"));
    assert_eq!(author.ref_column.as_deref(), Some("id"));
    // 无外键声明但命名符合 `<表名>_id` → 启发式识别
    let owner = book.header.iter().find(|c| c.name == "owner_id").unwrap();
    assert_eq!(owner.ref_table.as_deref(), Some("owner"));
    // 外键单元格附带目标行摘要（优先展示 name 列）
    let preview = book
        .refs
        .iter()
        .find(|r| r.table == "author" && r.id == 1)
        .unwrap();
    assert!(preview.summary.contains("Ada Lovelace"));

    let thing = repo
        .get_table_data("thing", 10, 0, &TableReadOptions::default())
        .await
        .unwrap();
    let wrong = thing
        .header
        .iter()
        .find(|c| c.name == "missing_table_id")
        .unwrap();
    assert_eq!(wrong.ref_table, None, "目标表不存在时不应提供跳转");
}

#[tokio::test]
async fn get_backrefs_finds_foreign_keys_and_heuristics() {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query("CREATE TABLE author (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO author VALUES (1, 'Ada Lovelace')")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query(
        "CREATE TABLE book (
                id INTEGER PRIMARY KEY,
                title TEXT,
                author_id INTEGER REFERENCES author(id)
            )",
    )
    .execute(&*pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO book VALUES (1, 'Notes', 1)")
        .execute(&*pool)
        .await
        .unwrap();
    // article.author_id 没有外键声明，但 `<表名>_id` 启发式应命中
    sqlx::query("CREATE TABLE article (id INTEGER PRIMARY KEY, title TEXT, author_id INTEGER)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO article VALUES (1, 'Sketch', 1)")
        .execute(&*pool)
        .await
        .unwrap();
    let repo = DBRepo { pool };

    let groups = repo.get_backrefs("author", 1).await.unwrap();
    assert_eq!(groups.len(), 2);
    let book = groups.iter().find(|g| g.source_table == "book").unwrap();
    assert_eq!(book.column, "author_id");
    assert_eq!(book.total, 1);
    assert!(book.rows[0].summary.contains("Notes"));
    let article = groups.iter().find(|g| g.source_table == "article").unwrap();
    assert_eq!(article.column, "author_id");
    assert!(article.rows[0].summary.contains("Sketch"));
}

#[tokio::test]
async fn get_table_data_filters_by_ref_column() {
    let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
    sqlx::query("CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT)")
        .execute(&*pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO parent VALUES (1, 'a'), (2, 'b')")
        .execute(&*pool)
        .await
        .unwrap();
    let repo = DBRepo { pool };

    let data = repo
        .get_table_data(
            "parent",
            10,
            0,
            &TableReadOptions {
                filter_col: Some("id".into()),
                filter_id: Some(2),
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(data.total, 1);
    assert_eq!(data.rows.len(), 1);
    assert_eq!(data.rows[0][0], serde_json::json!(2));

    // 列名不合法/不存在时忽略过滤，不注入 SQL
    let data = repo
        .get_table_data(
            "parent",
            10,
            0,
            &TableReadOptions {
                filter_col: Some("id; DROP TABLE parent".into()),
                filter_id: Some(1),
                ..TableReadOptions::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(data.total, 2);
    assert_eq!(data.rows.len(), 2);
}
