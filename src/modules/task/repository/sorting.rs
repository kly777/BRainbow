//! 列表排序的数据访问：smart 的候选集与依赖边，以及其余几种排序的 SQL。
//!
//! smart 排序在**应用层**做（`ranking.rs`）：阻塞因子要递归可达性、aging 要天数、
//! 理由要逐项构造 —— 用 SQL 表达不出来，硬写会变成一段没人敢改的 CASE 森林。
//! 这里只负责把候选集与依赖边取出来，以及其余四种纯 SQL 排序。

use std::collections::HashMap;

use crate::shared::actor::Actor;
use crate::shared::db_query::push_owner_scope;

use super::super::model::{Task, TaskSort};
use super::super::ranking::DependencyEdge;
use super::TaskRepository;

/// `task` 行的统一投影（运行时查询用；宏查询那份在 crud.rs，两边列名要对齐）
const TASK_PROJECTION: &str = "id, title, description, parent_task_id, \
     COALESCE(status, 'backlog') AS status, completed_at, effort_estimate_minutes, \
     start_at, due_at, priority, \
     COALESCE(created_at, CURRENT_TIMESTAMP) AS created_at, \
     COALESCE(updated_at, CURRENT_TIMESTAMP) AS updated_at";

impl TaskRepository {
    /// smart 排序的候选集：**未完成**（backlog / active）。
    ///
    /// 白名单而非黑名单（不写 `status != 'completed' AND ...`）：与"未知状态不该进排序"
    /// 的语义一致。已完成的不该出现在"先做哪件"的列表里 —— 它已经做完了。
    pub async fn find_open_candidates(&self, actor: &Actor) -> Result<Vec<Task>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::new("SELECT ");
        qb.push(TASK_PROJECTION);
        qb.push(" FROM task WHERE status IN ('backlog', 'active')");
        push_owner_scope(&mut qb, actor, "user_id");
        // SQL 侧不再排序（应用层会按分数重排），这里给个确定的初值便于调试
        qb.push(" ORDER BY updated_at DESC");
        qb.build_query_as::<Task>().fetch_all(&*self.db).await
    }

    /// 依赖边：`task_id → 它的前置依赖（标题 + 是否还没完成）`。
    ///
    /// 一次性取全（而非按需递归）：阻塞因子要看传递可达性，逐层查会变成 N+1。
    pub async fn dependency_edges(
        &self,
        actor: &Actor,
    ) -> Result<HashMap<i32, Vec<DependencyEdge>>, sqlx::Error> {
        let mut qb = sqlx::QueryBuilder::new(
            "SELECT d.task_id, d.depends_on_task_id, dep.title,
                    CASE WHEN dep.status IN ('completed', 'archived') THEN 0 ELSE 1 END AS is_open
               FROM task_dependency d
               JOIN task dep ON dep.id = d.depends_on_task_id
              WHERE 1 = 1",
        );
        // 依赖行的归属回到**父任务**上判（子表随父，doc/design/authorization.md）
        if let Some(uid) = actor.owner_scope() {
            qb.push(" AND d.task_id IN (SELECT id FROM task WHERE user_id = ");
            qb.push_bind(uid);
            qb.push(")");
        }

        let rows = qb
            .build_query_as::<(i32, i32, String, i64)>()
            .fetch_all(&*self.db)
            .await?;
        let mut map: HashMap<i32, Vec<DependencyEdge>> = HashMap::new();
        for (task_id, depends_on_id, title, is_open) in rows {
            map.entry(task_id).or_default().push(DependencyEdge {
                depends_on_id,
                title,
                is_open: is_open != 0,
            });
        }
        Ok(map)
    }

    /// 非 smart 的排序：分页与计数都走 SQL。
    ///
    /// 一律排除 archived（与 `list` 的既有口径一致）；`due`/`priority`/`effort`
    /// 都把 NULL 排到最后（"没填的"不该排在"填了最早的"前面）。
    pub async fn find_sorted_paginated(
        &self,
        actor: &Actor,
        sort: TaskSort,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        let order_by = match sort {
            // smart 不走这里（应用层排序）。真走到了就按 created 兜底 ——
            // 宁可按一个明确的口径排，也不要给出"看起来有序其实没排"的结果
            TaskSort::Smart | TaskSort::Created => "created_at DESC, id ASC",
            TaskSort::Due => "(due_at IS NULL) ASC, due_at ASC, id ASC",
            TaskSort::Priority => {
                "CASE priority WHEN 'p1' THEN 0 WHEN 'p2' THEN 1 WHEN 'p3' THEN 2 \
                 WHEN 'p4' THEN 3 ELSE 4 END ASC, created_at DESC, id ASC"
            }
            TaskSort::Effort => {
                "(effort_estimate_minutes IS NULL) ASC, effort_estimate_minutes ASC, id ASC"
            }
        };

        let mut count_qb =
            sqlx::QueryBuilder::new("SELECT COUNT(*) FROM task WHERE status != 'archived'");
        push_owner_scope(&mut count_qb, actor, "user_id");
        let total: i64 = count_qb.build_query_scalar().fetch_one(&*self.db).await?;

        let mut qb = sqlx::QueryBuilder::new("SELECT ");
        qb.push(TASK_PROJECTION);
        qb.push(" FROM task WHERE status != 'archived'");
        push_owner_scope(&mut qb, actor, "user_id");
        qb.push(" ORDER BY ");
        // `order_by` 是编译期常量表里挑出来的，不是用户输入 —— 无注入面
        qb.push(order_by);
        qb.push(" LIMIT ");
        qb.push_bind(limit);
        qb.push(" OFFSET ");
        qb.push_bind(offset);

        let items = qb.build_query_as::<Task>().fetch_all(&*self.db).await?;
        Ok((items, total))
    }
}
