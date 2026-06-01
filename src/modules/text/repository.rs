use sqlx::SqlitePool;
use std::sync::Arc;

pub struct TextRepo {
    pool: Arc<SqlitePool>,
}

impl TextRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    pub async fn load_tabs(&self) -> Result<Vec<(String, String)>, sqlx::Error> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT name, content FROM text_note ORDER BY id",
        )
        .fetch_all(&*self.pool)
        .await?;

        Ok(rows)
    }

    pub async fn save_tabs(&self, tabs: &[(String, String)]) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query("DELETE FROM text_note")
            .execute(&mut *tx)
            .await?;

        for (name, content) in tabs {
            sqlx::query(
                "INSERT INTO text_note (name, content, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))",
            )
            .bind(name)
            .bind(content)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}
