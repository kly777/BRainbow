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

    pub async fn load_tabs(&self) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows =
            sqlx::query_as::<_, TabRow>("SELECT id, name, content FROM text_note ORDER BY id")
                .fetch_all(&*self.pool)
                .await?;

        Ok(rows
            .into_iter()
            .map(|r| (r.id, r.name, r.content))
            .collect())
    }

    pub async fn save_tabs(&self, tabs: &[(String, String)]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!("DELETE FROM text_note")
            .execute(&mut *tx)
            .await?;

        for (name, content) in tabs {
            sqlx::query!(
                "INSERT INTO text_note (name, content, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
                name,
                content
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
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TextSearchRow,
            r#"SELECT id, name, content FROM text_note
               WHERE name LIKE ?1 ESCAPE '\' OR content LIKE ?1 ESCAPE '\'
               ORDER BY id DESC LIMIT ?2"#,
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

    async fn setup() -> TextRepo {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        crate::db::migrate(&pool).await.unwrap();
        TextRepo { pool }
    }

    #[tokio::test]
    async fn save_and_load_tabs() {
        let repo = setup().await;
        let tabs = vec![
            ("tab1".into(), "content1".into()),
            ("tab2".into(), "content2".into()),
        ];
        repo.save_tabs(&tabs).await.unwrap();
        let loaded = repo.load_tabs().await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].1, "tab1");
        assert_eq!(loaded[1].2, "content2");
    }

    #[tokio::test]
    async fn save_overwrites() {
        let repo = setup().await;
        repo.save_tabs(&[("a".into(), "old".into())]).await.unwrap();
        repo.save_tabs(&[("a".into(), "new".into())]).await.unwrap();
        let loaded = repo.load_tabs().await.unwrap();
        assert_eq!(loaded[0].2, "new");
    }

    #[tokio::test]
    async fn load_empty() {
        let repo = setup().await;
        let loaded = repo.load_tabs().await.unwrap();
        assert!(loaded.is_empty());
    }
}
