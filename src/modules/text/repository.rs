use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

#[derive(Debug, FromRow)]
struct TabRow {
    id: i64,
    name: String,
    content: String,
}

#[derive(Debug, FromRow)]
struct TextSearchRow {
    id: i64,
    name: String,
    content: String,
}

#[derive(Clone)]
pub struct TextRepo {
    pool: Arc<SqlitePool>,
}

impl TextRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn load_tabs(&self, user_id: i32) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as::<_, TabRow>(
            "SELECT id, name, content FROM text_note WHERE (user_id = ? OR user_id IS NULL) ORDER BY id",
        )
        .bind(user_id)
        .fetch_all(&*self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| (r.id, r.name, r.content))
            .collect())
    }

    pub async fn save_tabs(
        &self,
        user_id: i32,
        tabs: &[(String, String)],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!("DELETE FROM text_note WHERE (user_id = ? OR user_id IS NULL)", user_id)
            .execute(&mut *tx)
            .await?;

        for (name, content) in tabs {
            sqlx::query!(
                "INSERT INTO text_note (name, content, user_id, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                name,
                content,
                user_id
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// 全局搜索命中：返回 (id, name, content)
    pub async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TextSearchRow,
            r#"SELECT id, name, content FROM text_note
               WHERE (user_id = ?1 OR user_id IS NULL)
                 AND (name LIKE ?2 ESCAPE '\' OR content LIKE ?2 ESCAPE '\')
               ORDER BY id DESC LIMIT ?3"#,
            user_id,
            like,
            cap
        )
        .fetch_all(&*self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| (r.id, r.name, r.content))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    const TEST_USER_ID: i32 = 1;

    async fn setup() -> TextRepo {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&*pool).await.unwrap();
        TextRepo { pool }
    }

    #[tokio::test]
    async fn save_and_load_tabs() {
        let repo = setup().await;
        let tabs = vec![
            ("tab1".into(), "content1".into()),
            ("tab2".into(), "content2".into()),
        ];
        repo.save_tabs(TEST_USER_ID, &tabs).await.unwrap();
        let loaded = repo.load_tabs(TEST_USER_ID).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].1, "tab1");
        assert_eq!(loaded[1].2, "content2");
    }

    #[tokio::test]
    async fn save_overwrites() {
        let repo = setup().await;
        repo.save_tabs(TEST_USER_ID, &[("a".into(), "old".into())]).await.unwrap();
        repo.save_tabs(TEST_USER_ID, &[("a".into(), "new".into())]).await.unwrap();
        let loaded = repo.load_tabs(TEST_USER_ID).await.unwrap();
        assert_eq!(loaded[0].2, "new");
    }

    #[tokio::test]
    async fn load_empty() {
        let repo = setup().await;
        let loaded = repo.load_tabs(TEST_USER_ID).await.unwrap();
        assert!(loaded.is_empty());
    }
}
