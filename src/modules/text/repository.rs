use sqlx::{FromRow, SqlitePool};
use std::sync::Arc;

use crate::shared::actor::Actor;

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

    /// 读取草稿：admin 全部、普通用户自己的（判据见 `shared/actor.rs`）。
    ///
    /// 早先这条**没有任何归属条件** —— 谁都能读到所有人的草稿。
    pub async fn load_tabs(
        &self,
        actor: &Actor,
    ) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TabRow,
            r#"SELECT id, name, content FROM text_note
               WHERE (?1 IS NULL OR user_id = ?1)
               ORDER BY id"#,
            actor.owner_scope()
        )
        .fetch_all(&*self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|r| (r.id, r.name, r.content))
            .collect())
    }

    /// 整体替换**自己那一份**草稿。
    ///
    /// 这里刻意只删 `actor.user_id()` 的行（不用 `owner_scope`）：PUT 的语义是"替换我的集合"，
    /// 若按 admin 的全量口径删，管理员保存一次就会清空所有人的草稿。集合式写入的这条例外
    /// 记在 `doc/design/authorization.md` §3。
    ///
    /// 早先这里是 `DELETE FROM text_note`（全表清空）—— 任何用户保存一次都会抹掉别人的草稿。
    pub async fn save_tabs(
        &self,
        actor: &Actor,
        tabs: &[(String, String)],
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;

        sqlx::query!("DELETE FROM text_note WHERE user_id = ?", actor.user_id())
            .execute(&mut *tx)
            .await?;

        for (name, content) in tabs {
            sqlx::query!(
                "INSERT INTO text_note (name, content, user_id, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))",
                name,
                content,
                actor.user_id()
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// 全局搜索命中：返回 (id, name, content)（归属口径见 shared/actor.rs）
    pub async fn search_hits(
        &self,
        actor: &Actor,
        like: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TextSearchRow,
            r#"SELECT id, name, content FROM text_note
               WHERE (?1 IS NULL OR user_id = ?1)
                 AND (name LIKE ?2 ESCAPE '\' OR content LIKE ?2 ESCAPE '\')
               ORDER BY id DESC LIMIT ?3"#,
            actor.owner_scope(),
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

    pub async fn search_hits_fts(
        &self,
        actor: &Actor,
        fts_query: &str,
        cap: i64,
    ) -> Result<Vec<(i64, String, String)>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TextSearchRow,
            r#"SELECT t.id, t.name, t.content
               FROM text_note_fts fts
               JOIN text_note t ON t.id = fts.rowid
               WHERE text_note_fts MATCH ?2
                 AND (?1 IS NULL OR t.user_id = ?1)
               ORDER BY rank
               LIMIT ?3"#,
            actor.owner_scope(),
            fts_query,
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
        // 草稿有外键指向 user，先立两个用户（1=普通用户，2=另一个普通用户）
        for id in [1, 2] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(format!("u{id}"))
                .execute(&*pool)
                .await
                .unwrap();
        }
        TextRepo { pool }
    }

    fn user(id: i32) -> Actor {
        Actor::user(id)
    }

    #[tokio::test]
    async fn save_and_load_tabs() {
        let repo = setup().await;
        let tabs = vec![
            ("tab1".into(), "content1".into()),
            ("tab2".into(), "content2".into()),
        ];
        repo.save_tabs(&user(1), &tabs).await.unwrap();
        let loaded = repo.load_tabs(&user(1)).await.unwrap();
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].1, "tab1");
        assert_eq!(loaded[1].2, "content2");
    }

    #[tokio::test]
    async fn save_overwrites() {
        let repo = setup().await;
        repo.save_tabs(&user(1), &[("a".into(), "old".into())]).await.unwrap();
        repo.save_tabs(&user(1), &[("a".into(), "new".into())]).await.unwrap();
        let loaded = repo.load_tabs(&user(1)).await.unwrap();
        assert_eq!(loaded[0].2, "new");
    }

    #[tokio::test]
    async fn load_empty() {
        let repo = setup().await;
        let loaded = repo.load_tabs(&user(1)).await.unwrap();
        assert!(loaded.is_empty());
    }

    /// 草稿按归属隔离：别人的草稿读不到，保存也只替换自己那一份
    #[tokio::test]
    async fn tabs_are_scoped_to_the_owner() {
        let repo = setup().await;
        repo.save_tabs(&user(1), &[("a".into(), "A 的草稿".into())])
            .await
            .unwrap();
        repo.save_tabs(&user(2), &[("b".into(), "B 的草稿".into())])
            .await
            .unwrap();

        let a = repo.load_tabs(&user(1)).await.unwrap();
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].2, "A 的草稿");

        // B 保存不会清掉 A 的（早先是 DELETE FROM text_note 全表清空）
        repo.save_tabs(&user(2), &[("b2".into(), "B 改了".into())])
            .await
            .unwrap();
        let a = repo.load_tabs(&user(1)).await.unwrap();
        assert_eq!(a.len(), 1, "A 的草稿应还在（快照见文件末尾注释）");

        // admin 按全量口径读得到两份
        let all = repo.load_tabs(&Actor::admin(3)).await.unwrap();
        assert_eq!(all.len(), 2);
    }
}
