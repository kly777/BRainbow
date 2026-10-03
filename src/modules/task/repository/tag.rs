//! 任务标签的数据访问：复用 `tag` 表（`UNIQUE(name, user_id)`，按用户隔离），
//! 关联走 `task_tag_rel`（复合主键 + 两个级联）。
//!
//! 语义是**整体替换**（PUT 而非 PATCH-on-collection）：前端从 `GET /tasks/{id}` 拿到
//! 该任务的完整标签集，改完整体发回来 —— 增量增删要多一次往返，还容易与服务端不一致。

use std::collections::HashMap;

use crate::shared::actor::Actor;
use crate::shared::db_query::push_owner_scope;

use super::super::response::Tag;
use super::TaskRepository;

impl TaskRepository {
    /// 把任务的标签**整体替换**成 `names`，返回替换后的标签（含各自的 id）。
    ///
    /// 标签归**任务的持有者**（不是编辑者）：admin 改别人的任务时，加上的标签也记在
    /// 任务主人名下 —— 否则同一个任务会被两套标签名劈开。
    ///
    /// 名字先 trim、去空、去重（大小写不同算两个标签，与 `UNIQUE(name, user_id)` 口径一致）；
    /// 按 `(name, owner)` upsert —— 已存在的复用，新的建一条。
    pub async fn set_tags(
        &self,
        task_id: i32,
        owner: i32,
        names: &[String],
    ) -> Result<Vec<Tag>, sqlx::Error> {
        let mut wanted: Vec<String> = Vec::new();
        for name in names {
            let name = name.trim();
            if name.is_empty() || wanted.iter().any(|existing| existing == name) {
                continue;
            }
            wanted.push(name.to_string());
        }

        let mut tx = self.db.begin().await?;

        let mut tags = Vec::new();
        for name in &wanted {
            // upsert：同名同用户唯一，冲突时拿回既有 id
            let tag_id: i64 = sqlx::query_scalar(
                "INSERT INTO tag (name, user_id) VALUES (?1, ?2)
                 ON CONFLICT(name, user_id) DO UPDATE SET name = excluded.name
                 RETURNING id",
            )
            .bind(name)
            .bind(owner)
            .fetch_one(&mut *tx)
            .await?;

            sqlx::query("INSERT OR IGNORE INTO task_tag_rel (task_id, tag_id) VALUES (?1, ?2)")
                .bind(task_id)
                .bind(tag_id)
                .execute(&mut *tx)
                .await?;

            tags.push(Tag {
                id: tag_id as i32,
                name: name.clone(),
            });
        }

        // 整体替换：清掉这次没提到的关联（放在最后，中途失败不会留下半个集合）。
        // 只删这个**任务**的关联，标签本身留着 —— 别的任务可能还在用
        if wanted.is_empty() {
            sqlx::query("DELETE FROM task_tag_rel WHERE task_id = ?1")
                .bind(task_id)
                .execute(&mut *tx)
                .await?;
        } else {
            let mut qb =
                sqlx::QueryBuilder::new("DELETE FROM task_tag_rel WHERE task_id = ");
            qb.push_bind(task_id);
            qb.push(" AND tag_id NOT IN (");
            let mut separated = qb.separated(", ");
            for tag in &tags {
                separated.push_bind(tag.id);
            }
            qb.push(")");
            qb.build().execute(&mut *tx).await?;
        }

        tx.commit().await?;
        Ok(tags)
    }

    /// 一批任务的标签（列表用一次查询挂上，避免 N+1）。没有标签的任务不在返回值里。
    pub async fn tags_for_tasks(
        &self,
        task_ids: &[i32],
    ) -> Result<HashMap<i32, Vec<Tag>>, sqlx::Error> {
        if task_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut qb = sqlx::QueryBuilder::new(
            "SELECT r.task_id, t.id, t.name FROM task_tag_rel r
             JOIN tag t ON t.id = r.tag_id WHERE r.task_id IN (",
        );
        let mut separated = qb.separated(", ");
        for id in task_ids {
            separated.push_bind(id);
        }
        qb.push(") ORDER BY t.name");

        let rows: Vec<(i32, i32, String)> = qb.build_query_as().fetch_all(&*self.db).await?;
        let mut map: HashMap<i32, Vec<Tag>> = HashMap::new();
        for (task_id, id, name) in rows {
            map.entry(task_id).or_default().push(Tag { id, name });
        }
        Ok(map)
    }

    /// 这个用户有哪些标签（录入框自动补全用：前缀过滤、按名取前 `limit` 条）。
    ///
    /// 前缀按小写匹配（`LIKE` 对 ASCII 不区分大小写，但中文没有大小写，所以直接
    /// `lower(name) LIKE lower(prefix)%` 两边都降下来更可控）；`%`/`_` 要转义，
    /// 否则用户打一个 `%` 就把全部标签都捞出来。
    pub async fn tags_with_prefix(
        &self,
        actor: &Actor,
        prefix: &str,
        limit: i64,
    ) -> Result<Vec<Tag>, sqlx::Error> {
        let like = format!(
            "{}%",
            crate::shared::db_query::escape_like(&prefix.to_lowercase())
        );
        let mut qb = sqlx::QueryBuilder::new("SELECT id, name FROM tag WHERE lower(name) LIKE ");
        qb.push_bind(like);
        qb.push(" ESCAPE '\\'");
        push_owner_scope(&mut qb, actor, "user_id");
        qb.push(" ORDER BY name LIMIT ");
        qb.push_bind(limit);
        Ok(qb
            .build_query_as::<(i32, String)>()
            .fetch_all(&*self.db)
            .await?
            .into_iter()
            .map(|(id, name)| Tag { id, name })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use crate::db;

    async fn repo_with_tags() -> TaskRepository {
        let pool = std::sync::Arc::new(sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap());
        db::migrate(&pool).await.unwrap();
        for (id, name) in [(1, "alice"), (2, "bob")] {
            sqlx::query("INSERT INTO user (id, name, password_hash) VALUES (?, ?, 'x')")
                .bind(id)
                .bind(name)
                .execute(&*pool)
                .await
                .unwrap();
        }
        for (name, owner) in [
            ("工作", 1),
            ("工作台", 1),
            ("家务", 1),
            ("100%完成", 1),
            ("别人的标签", 2),
        ] {
            sqlx::query("INSERT INTO tag (name, user_id) VALUES (?, ?)")
                .bind(name)
                .bind(owner)
                .execute(&*pool)
                .await
                .unwrap();
        }
        TaskRepository::new(pool)
    }

    #[tokio::test]
    async fn prefix_matches_only_own_tags() {
        let repo = repo_with_tags().await;
        let names: Vec<String> = repo
            .tags_with_prefix(&Actor::user(1), "工作", 8)
            .await
            .unwrap()
            .into_iter()
            .map(|tag| tag.name)
            .collect();
        assert_eq!(names, vec!["工作", "工作台"]);
    }

    /// `%` / `_` 是 LIKE 的通配符，必须转义 —— 否则打一个 `%` 就把全部标签捞出来
    #[tokio::test]
    async fn like_wildcards_are_escaped() {
        let repo = repo_with_tags().await;
        let names: Vec<String> = repo
            .tags_with_prefix(&Actor::user(1), "100%", 8)
            .await
            .unwrap()
            .into_iter()
            .map(|tag| tag.name)
            .collect();
        assert_eq!(names, vec!["100%完成"]);

        // 单独的 `%` 不是"全部"，而是"以 % 开头"（没有这样的标签）
        assert!(
            repo.tags_with_prefix(&Actor::user(1), "%", 8)
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn empty_prefix_returns_all_of_mine_up_to_limit() {
        let repo = repo_with_tags().await;
        let mine = repo.tags_with_prefix(&Actor::user(1), "", 8).await.unwrap();
        assert_eq!(mine.len(), 4, "只数自己的（别人的标签不算）");

        let limited = repo.tags_with_prefix(&Actor::user(1), "", 2).await.unwrap();
        assert_eq!(limited.len(), 2);
    }

    #[tokio::test]
    async fn admin_sees_everyones_tags() {
        let repo = repo_with_tags().await;
        assert_eq!(
            repo.tags_with_prefix(&Actor::admin(1), "", 8)
                .await
                .unwrap()
                .len(),
            5
        );
    }
}
