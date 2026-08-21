use chrono::{DateTime, Utc};
use std::sync::Arc;

use async_trait::async_trait;

use super::model::{Task, TaskStatus};
use super::repository::TaskRepository;
use crate::modules::time_window::TimeWindow;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit, SearchPort, snippet};

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：`TaskQueryService` 只暴露不修改状态的读方法。
/// 写操作（含 `validate_time_windows` 等参与命令约束的读取）保留在 `TaskService` 中。
#[derive(Clone)]
pub struct TaskQueryService {
    repo: TaskRepository,
}

impl TaskQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskRepository::new(db),
        }
    }

    pub async fn list(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_excluding_archived_paginated(user_id, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn list_all(
        &self,
        user_id: i32,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_paginated(user_id, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, user_id: i32, id: i32) -> Result<Option<Task>, ServiceError> {
        self.repo.find_by_id(user_id, id).await.map_err(ServiceError::Db)
    }

    pub async fn detail(
        &self,
        user_id: i32,
        id: i32,
    ) -> Result<Option<super::dto::TaskDetailResponse>, ServiceError> {
        self.repo.find_detail(user_id, id).await.map_err(ServiceError::Db)
    }

    pub async fn tree(&self, user_id: i32, root: Option<i32>) -> Result<Vec<Task>, ServiceError> {
        self.repo.find_tree(user_id, root).await.map_err(ServiceError::Db)
    }

    pub async fn stats(&self, user_id: i32) -> Result<(i64, i64, i64, i64), ServiceError> {
        self.repo.get_stats(user_id).await.map_err(ServiceError::Db)
    }

    pub async fn by_status(
        &self,
        user_id: i32,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_by_status_paginated(user_id, status, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        user_id: i32,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .search_by_title_paginated(user_id, query, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    /// 获取日历事件 - 查询指定时间范围内的所有非归档任务的时间窗口
    pub async fn calendar(
        &self,
        user_id: i32,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TimeWindow)>, ServiceError> {
        self.repo
            .find_calendar_events(user_id, start, end, status)
            .await
            .map_err(ServiceError::Db)
    }

    /// 构建依赖图（DAG）— 批量查询，避免 N+1
    pub async fn dag(
        &self,
        user_id: i32,
        root_task_id: Option<i32>,
        depth: i32,
    ) -> Result<super::response::DagView, ServiceError> {
        use super::response::{DagEdge, DagNode, DagView};
        use std::collections::{HashMap, HashSet, VecDeque};

        let (all_tasks, _) = self
            .repo
            .find_all_paginated(user_id, 10000, 0)
            .await
            .map_err(ServiceError::Db)?;
        let task_map: HashMap<i32, &Task> = all_tasks.iter().map(|t| (t.id, t)).collect();

        // 批量取全部依赖
        let all_deps = self
            .repo
            .get_all_dependencies(user_id)
            .await
            .map_err(ServiceError::Db)?;

        let mut nodes_map: HashMap<i32, DagNode> = HashMap::new();
        let mut edges: Vec<DagEdge> = Vec::new();
        let mut visited: HashSet<i32> = HashSet::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();

        if let Some(root_id) = root_task_id {
            queue.push_back((root_id, 0));
        } else {
            for (&task_id, deps) in &all_deps {
                if !deps.is_empty() {
                    queue.push_back((task_id, 0));
                }
            }
        }

        while let Some((task_id, current_depth)) = queue.pop_front() {
            if current_depth > depth || !visited.insert(task_id) {
                continue;
            }

            if let Some(&task) = task_map.get(&task_id) {
                nodes_map.entry(task_id).or_insert_with(|| DagNode {
                    id: task.id,
                    title: task.title.clone(),
                    status: task.status.clone(),
                });

                if let Some(deps) = all_deps.get(&task_id) {
                    for &dep_id in deps {
                        if let Some(&dep_task) = task_map.get(&dep_id) {
                            nodes_map.entry(dep_id).or_insert_with(|| DagNode {
                                id: dep_task.id,
                                title: dep_task.title.clone(),
                                status: dep_task.status.clone(),
                            });
                        }
                        edges.push(DagEdge {
                            from: task_id,
                            to: dep_id,
                        });
                        queue.push_back((dep_id, current_depth + 1));
                    }
                }
            }
        }

        Ok(DagView {
            nodes: nodes_map.into_values().collect(),
            edges,
        })
    }
}

#[async_trait]
impl SearchPort for TaskQueryService {
    async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let kw = q.trim();
        if kw.is_empty() {
            return Ok(vec![]);
        }
        let cap = limit.clamp(1, 20);
        let like = crate::shared::db_query::like_contains(kw);
        let rows = self
            .repo
            .search_hits(user_id, &like, cap)
            .await
            .map_err(ServiceError::Db)?;
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "task".into(),
                id: r.id,
                title: r.title,
                snippet: snippet(r.description.as_deref().unwrap_or(""), kw),
                url: format!("/task/{}", r.id),
            })
            .collect())
    }
}
