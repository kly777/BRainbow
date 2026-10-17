use chrono::{DateTime, Utc};
use sqlx::{FromRow, QueryBuilder};

use crate::shared::actor::Actor;
use crate::shared::db_query::{like_contains, push_owner_scope};

use super::super::block::TaskBlock;
use super::super::dto::TaskDetailResponse;
use super::super::model::{Task, TaskStatus};
use super::super::response::TaskResponse;
use super::TaskRepository;

#[derive(FromRow)]
struct TaskDepRow {
    depends_on_task_id: i32,
}

#[derive(FromRow)]
pub(crate) struct TaskHitRow {
    pub(crate) id: i64,
    pub(crate) title: String,
    pub(crate) description: Option<String>,
    #[allow(dead_code)]
    pub(crate) title_hit: i64,
}

#[derive(FromRow)]
struct CalendarRow {
    id: i32,
    title: String,
    description: Option<String>,
    parent_task_id: Option<i32>,
    status: TaskStatus,
    completed_at: Option<DateTime<Utc>>,
    effort_estimate_minutes: Option<i32>,
    start_at: Option<DateTime<Utc>>,
    due_at: Option<DateTime<Utc>>,
    priority: Option<crate::modules::task::model::TaskPriority>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    block_id: i32,
    block_start: DateTime<Utc>,
    block_end: Option<DateTime<Utc>>,
    block_kind: String,
    block_task_id: i32,
    block_user_id: Option<i32>,
    block_fixed: i64,
    block_source: String,
    block_created_at: DateTime<Utc>,
    block_updated_at: DateTime<Utc>,
}

impl TaskRepository {
    /// 任务树（递归 CTE）：锚点与递归段都过归属过滤。
    ///
    /// 递归段也要过滤 —— 否则别人挂在我任务下的子任务会顺着树泄出来
    /// （`parent_task_id` 是自由的，`create`/`update` 只为"自己的父任务"放行，
    /// 历史数据里可能留有跨界挂载）。
    pub async fn find_tree(
        &self,
        actor: &Actor,
        root_task_id: Option<i32>,
    ) -> Result<Vec<Task>, sqlx::Error> {
        let mut builder = QueryBuilder::new(
            "WITH RECURSIVE task_tree AS (
                SELECT id, title, description, parent_task_id, status, completed_at,
                       effort_estimate_minutes, start_at, due_at, priority, created_at, updated_at
                FROM task
                WHERE 1 = 1",
        );
        push_owner_scope(&mut builder, actor, "user_id");
        builder.push(" AND (");

        if let Some(root_id) = root_task_id {
            builder.push("id = ");
            builder.push_bind(root_id);
        } else {
            builder.push("parent_task_id IS NULL");
        }
        builder.push(")");
        // 注意：下面原有 builder.push("... UNION ALL ...") 继续拼接

        builder.push(
            "
            UNION ALL
            SELECT t.id, t.title, t.description, t.parent_task_id, t.status, t.completed_at,
                   t.effort_estimate_minutes, t.start_at, t.due_at, t.priority,
                   t.created_at, t.updated_at
            FROM task t
            INNER JOIN task_tree tt ON t.parent_task_id = tt.id
            WHERE 1 = 1",
        );
        push_owner_scope(&mut builder, actor, "t.user_id");
        builder.push(
            ")
        SELECT * FROM task_tree ORDER BY created_at",
        );

        builder.build_query_as::<Task>().fetch_all(&*self.db).await
    }

    pub async fn find_detail(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<TaskDetailResponse>, sqlx::Error> {
        let Some(task) = self.find_by_id(actor, id).await? else {
            return Ok(None);
        };

        // 子表随父：依赖行的归属回到 `task_dependency.task_id` 的父任务上判
        let dependencies = sqlx::query_as!(
            TaskDepRow,
            r#"SELECT depends_on_task_id AS "depends_on_task_id: i32"
               FROM task_dependency
               WHERE task_id = ?1
                 AND (?2 IS NULL OR EXISTS (
                       SELECT 1 FROM task p
                       WHERE p.id = task_dependency.task_id AND p.user_id = ?2))"#,
            id,
            actor.owner_scope()
        )
        .fetch_all(&*self.db)
        .await?
        .into_iter()
        .map(|r| r.depends_on_task_id)
        .collect::<Vec<_>>();

        // 子任务是独立的行：按自己的归属过滤（父任务是别人的不等于子任务是你的）
        let children = sqlx::query_as!(
            Task,
            r#"SELECT id AS "id: i32", title, description,
                      parent_task_id AS "parent_task_id?: i32",
                      COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                      completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                      effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                      start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                      due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                      priority AS "priority?: crate::modules::task::model::TaskPriority",
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE parent_task_id = ?1 AND (?2 IS NULL OR user_id = ?2)
               ORDER BY created_at"#,
            id,
            actor.owner_scope()
        )
        .fetch_all(&*self.db)
        .await?;

        let blocks = sqlx::query_as::<_, TaskBlock>(
            r#"SELECT id, user_id, task_id, kind, start_at, end_at, fixed, source,
                      created_at, updated_at
               FROM task_block WHERE task_id = ?1 ORDER BY start_at"#,
        )
        .bind(id)
        .fetch_all(&*self.db)
        .await?;

        let mut feasible_blocks = Vec::new();
        let mut planned_blocks = Vec::new();
        for block in blocks {
            if block.kind == "feasible" {
                feasible_blocks.push(block);
            } else {
                planned_blocks.push(block);
            }
        }

        Ok(Some(TaskDetailResponse {
            task: TaskResponse::from(task),
            depends_on: dependencies,
            children: children.into_iter().map(TaskResponse::from).collect(),
            feasible_blocks,
            planned_blocks,
        }))
    }

    /// 全局搜索命中：标题命中优先于描述命中（LIKE 查询，用于短关键词）
    pub async fn search_hits(
        &self,
        actor: &Actor,
        like: &str,
        cap: i64,
    ) -> Result<Vec<TaskHitRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TaskHitRow,
            r#"SELECT id, title, description,
                      title LIKE ?2 ESCAPE '\' AS "title_hit!: i64"
               FROM task
               WHERE (?1 IS NULL OR user_id = ?1)
                 AND (title LIKE ?2 ESCAPE '\' OR description LIKE ?2 ESCAPE '\')
               ORDER BY (title LIKE ?2 ESCAPE '\') DESC, id DESC LIMIT ?3"#,
            actor.owner_scope(),
            like,
            cap
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows)
    }

    /// 全局搜索命中：FTS5 全文索引查询（3+字符）
    pub async fn search_hits_fts(
        &self,
        actor: &Actor,
        fts_query: &str,
        cap: i64,
    ) -> Result<Vec<TaskHitRow>, sqlx::Error> {
        let rows = sqlx::query_as!(
            TaskHitRow,
            r#"SELECT t.id, t.title, t.description,
                      0 AS "title_hit!: i64"
               FROM task_fts fts
               JOIN task t ON t.id = fts.rowid
               WHERE task_fts MATCH ?2
                 AND (?1 IS NULL OR t.user_id = ?1)
               ORDER BY rank
               LIMIT ?3"#,
            actor.owner_scope(),
            fts_query,
            cap
        )
        .fetch_all(&*self.db)
        .await?;
        Ok(rows)
    }

    pub async fn search_by_title_paginated(
        &self,
        actor: &Actor,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let pattern = like_contains(query);
        let total: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE title LIKE ?1 ESCAPE '\\' AND (?2 IS NULL OR user_id = ?2)",
            pattern,
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;
        let items = sqlx::query_as!(
            Task,
            r#"SELECT id AS "id: i32", title, description,
                      parent_task_id AS "parent_task_id?: i32",
                      COALESCE(status, 'backlog') AS "status!: crate::modules::task::model::TaskStatus",
                      completed_at AS "completed_at?: chrono::DateTime<chrono::Utc>",
                      effort_estimate_minutes AS "effort_estimate_minutes?: i32",
                      start_at AS "start_at?: chrono::DateTime<chrono::Utc>",
                      due_at AS "due_at?: chrono::DateTime<chrono::Utc>",
                      priority AS "priority?: crate::modules::task::model::TaskPriority",
                      COALESCE(created_at, CURRENT_TIMESTAMP) AS "created_at!: chrono::DateTime<chrono::Utc>",
                      COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: chrono::DateTime<chrono::Utc>"
               FROM task WHERE title LIKE ?1 ESCAPE '\' AND (?2 IS NULL OR user_id = ?2)
               ORDER BY created_at DESC LIMIT ?3 OFFSET ?4"#,
            pattern,
            actor.owner_scope(),
            limit,
            offset
        )
        .fetch_all(&*self.db)
        .await?;
        Ok((items, total))
    }

    pub async fn find_calendar_events(
        &self,
        actor: &Actor,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status_filter: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TaskBlock)>, sqlx::Error> {
        let default_start = DateTime::from_timestamp(0, 0).unwrap_or_default();
        let default_end = DateTime::from_timestamp(4102444800, 0).unwrap_or_default();
        let range_start = start.unwrap_or(default_start);
        let range_end = end.unwrap_or(default_end);

        let rows = sqlx::query_as::<_, CalendarRow>(
            r#"SELECT t.id, t.title, t.description,
                      t.parent_task_id, COALESCE(t.status, 'backlog') AS status,
                      t.completed_at, t.effort_estimate_minutes, t.start_at, t.due_at,
                      t.priority, COALESCE(t.created_at, CURRENT_TIMESTAMP) AS created_at,
                      COALESCE(t.updated_at, CURRENT_TIMESTAMP) AS updated_at,
                      b.id AS block_id, b.start_at AS block_start, b.end_at AS block_end,
                      b.kind AS block_kind, b.task_id AS block_task_id,
                      b.user_id AS block_user_id, b.fixed AS block_fixed,
                      b.source AS block_source, b.created_at AS block_created_at,
                      b.updated_at AS block_updated_at
               FROM task t
               INNER JOIN task_block b ON t.id = b.task_id
               WHERE (?1 IS NULL OR t.status = ?1)
                 AND (?1 IS NOT NULL OR t.status != 'archived')
                 AND (?2 IS NULL OR t.user_id = ?2)
                 AND b.start_at < ?3
                 AND (b.end_at IS NULL OR b.end_at > ?4)
               ORDER BY b.start_at"#,
        )
        .bind(status_filter.map(|s| s.as_str().to_string()))
        .bind(actor.owner_scope())
        .bind(range_end)
        .bind(range_start)
        .fetch_all(&*self.db)
        .await?;

        let mut events = Vec::new();
        for row in rows {
            let task = Task {
                id: row.id,
                title: row.title,
                description: row.description,
                parent_task_id: row.parent_task_id,
                status: row.status,
                completed_at: row.completed_at,
                effort_estimate_minutes: row.effort_estimate_minutes,
                start_at: row.start_at,
                due_at: row.due_at,
                priority: row.priority,
                created_at: row.created_at,
                updated_at: row.updated_at,
            };
            let block = TaskBlock {
                id: row.block_id,
                user_id: row.block_user_id,
                task_id: row.block_task_id,
                kind: row.block_kind,
                start_at: row.block_start,
                end_at: row.block_end,
                fixed: row.block_fixed,
                source: row.block_source,
                created_at: row.block_created_at,
                updated_at: row.block_updated_at,
            };
            events.push((task, block));
        }
        Ok(events)
    }

    /// 某个任务的时间块 —— 归属随父任务。
    #[allow(dead_code)]
    pub async fn find_blocks_by_task(
        &self,
        actor: &Actor,
        task_id: i32,
    ) -> Result<Vec<TaskBlock>, sqlx::Error> {
        sqlx::query_as::<_, TaskBlock>(
            r#"SELECT b.id, b.user_id, b.task_id, b.kind, b.start_at, b.end_at,
                      b.fixed, b.source, b.created_at, b.updated_at
               FROM task_block b
               WHERE b.task_id = ?2
                 AND (?1 IS NULL OR EXISTS (
                       SELECT 1 FROM task t WHERE t.id = b.task_id AND t.user_id = ?1))
               ORDER BY b.start_at"#,
        )
        .bind(actor.owner_scope())
        .bind(task_id)
        .fetch_all(&*self.db)
        .await
    }

    pub async fn get_stats(&self, actor: &Actor) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        let backlog: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status = 'backlog' AND (?1 IS NULL OR user_id = ?1)",
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        let active: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status = 'active' AND (?1 IS NULL OR user_id = ?1)",
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        let completed: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status = 'completed' AND (?1 IS NULL OR user_id = ?1)",
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        let archived: i64 = sqlx::query_scalar!(
            "SELECT COUNT(*) FROM task WHERE status = 'archived' AND (?1 IS NULL OR user_id = ?1)",
            actor.owner_scope()
        )
        .fetch_one(&*self.db)
        .await?;

        Ok((backlog, active, completed, archived))
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;
    use std::sync::Arc;

    const TEST_USER_ID: i32 = 1;

    /// 测试调用者：普通用户（`owner` 就是 TEST_USER_ID）
    fn actor() -> Actor {
        Actor::user(TEST_USER_ID)
    }

    async fn setup() -> TaskRepository {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO user (id, name, password_hash) VALUES (1, 'test', 'x')")
            .execute(&pool)
            .await
            .unwrap();
        TaskRepository::new(Arc::new(pool))
    }

    /// 任务都必须带 `user_id` —— 两档判据下"无主行"只对 admin 可见
    async fn insert_task(repo: &TaskRepository, title: &str, parent: Option<i32>) -> i32 {
        sqlx::query_scalar::<_, i32>(
            "INSERT INTO task (title, parent_task_id, user_id) VALUES (?, ?, ?) RETURNING id",
        )
        .bind(title)
        .bind(parent)
        .bind(TEST_USER_ID)
        .fetch_one(&*repo.db)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn find_tree_without_root_includes_descendants() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        let other = insert_task(&repo, "other", None).await;

        let ids: Vec<i32> = repo
            .find_tree(&actor(), None)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        for expected in [root, child, other] {
            assert!(ids.contains(&expected), "tree should contain {expected}");
        }
    }

    #[tokio::test]
    async fn find_tree_with_root_returns_only_subtree() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        let other = insert_task(&repo, "other", None).await;

        let ids: Vec<i32> = repo
            .find_tree(&actor(), Some(root))
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        assert!(ids.contains(&root));
        assert!(ids.contains(&child));
        assert!(!ids.contains(&other));
    }

    #[tokio::test]
    async fn search_by_title_matches_literal_wildcard_chars_only() {
        let repo = setup().await;
        insert_task(&repo, "50% complete", None).await;
        insert_task(&repo, "500 complete", None).await;
        insert_task(&repo, "a_b", None).await;
        insert_task(&repo, "aXb", None).await;

        let (hits, total) = repo
            .search_by_title_paginated(&actor(), "50%", 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].title, "50% complete");

        let (hits, total) = repo
            .search_by_title_paginated(&actor(), "a_b", 10, 0)
            .await
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(hits[0].title, "a_b");
    }

    #[tokio::test]
    async fn find_detail_returns_dependencies_children_and_windows() {
        let repo = setup().await;
        let root = insert_task(&repo, "root", None).await;
        let child = insert_task(&repo, "child", Some(root)).await;
        sqlx::query("INSERT INTO task_dependency (task_id, depends_on_task_id) VALUES (?, ?)")
            .bind(root)
            .bind(child)
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO task_block (start_at, end_at, kind, task_id)
             VALUES ('2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z', 'feasible', ?)",
        )
        .bind(root)
        .execute(&*repo.db)
        .await
        .unwrap();

        let detail = repo.find_detail(&actor(), root).await.unwrap().unwrap();
        assert_eq!(detail.task.id, root);
        assert_eq!(detail.depends_on, vec![child]);
        assert_eq!(detail.children.len(), 1);
        assert_eq!(detail.children[0].id, child);
        assert_eq!(detail.feasible_blocks.len(), 1);
        assert!(detail.planned_blocks.is_empty());
    }

    #[tokio::test]
    async fn find_calendar_events_filters_status_and_range() {
        let repo = setup().await;
        let active = insert_task(&repo, "active", None).await;
        let archived = insert_task(&repo, "archived", None).await;
        sqlx::query("UPDATE task SET status = 'active' WHERE id = ?")
            .bind(active)
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'archived' WHERE id = ?")
            .bind(archived)
            .execute(&*repo.db)
            .await
            .unwrap();

        for (id, hour) in [(active, 8), (archived, 9)] {
            let window_start = DateTime::from_timestamp(1_767_225_600 + hour * 3600, 0).unwrap();
            let window_end =
                DateTime::from_timestamp(1_767_225_600 + (hour + 1) * 3600, 0).unwrap();
            sqlx::query(
                "INSERT INTO task_block (start_at, end_at, kind, task_id)
                 VALUES (?, ?, 'planned', ?)",
            )
            .bind(window_start)
            .bind(window_end)
            .bind(id)
            .execute(&*repo.db)
            .await
            .unwrap();
        }

        let start = DateTime::from_timestamp(1_767_225_600, 0).unwrap(); // 2026-01-01T00:00:00Z
        let end = DateTime::from_timestamp(1_767_312_000, 0).unwrap(); // 2026-01-02T00:00:00Z

        // 默认排除 archived
        let events = repo
            .find_calendar_events(&actor(), Some(start), Some(end), None)
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0.id, active);

        // 显式按 archived 过滤
        let events = repo
            .find_calendar_events(&actor(), Some(start), Some(end), Some(TaskStatus::Archived))
            .await
            .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0.id, archived);
    }

    #[tokio::test]
    async fn get_stats_counts_each_status() {
        let repo = setup().await;
        for title in ["b", "a", "c", "d"] {
            insert_task(&repo, title, None).await;
        }
        sqlx::query("UPDATE task SET status = 'active' WHERE title = 'a'")
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'completed' WHERE title = 'c'")
            .execute(&*repo.db)
            .await
            .unwrap();
        sqlx::query("UPDATE task SET status = 'archived' WHERE title = 'd'")
            .execute(&*repo.db)
            .await
            .unwrap();

        assert_eq!(repo.get_stats(&actor()).await.unwrap(), (1, 1, 1, 1));
    }
}
