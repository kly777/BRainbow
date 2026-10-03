use chrono::{DateTime, Utc};
use std::sync::Arc;

use async_trait::async_trait;

use super::model::{Task, TaskStatus};
use super::repository::TaskRepository;
use crate::modules::time_window::TimeWindow;
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{
    SearchHit, SearchPort, SearchTarget, fts_query, normalize_search, snippet,
};

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
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_excluding_archived_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn list_all(
        &self,
        actor: &Actor,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_all_paginated(actor, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn by_id(&self, actor: &Actor, id: i32) -> Result<Option<Task>, ServiceError> {
        self.repo
            .find_by_id(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 列表/单条响应的**统一出口**：`Task` → `TaskResponse` 并挂上标签。
    pub async fn responses(
        &self,
        tasks: Vec<Task>,
    ) -> Result<Vec<super::response::TaskResponse>, ServiceError> {
        let mut items: Vec<super::response::TaskResponse> =
            tasks.into_iter().map(super::response::TaskResponse::from).collect();
        self.attach_tags(&mut items).await?;
        Ok(items)
    }

    /// 给一批响应挂上标签：**一次**批量查询（列表不做 N+1），按 id 回填。
    ///
    /// 读不到标签就让整个请求失败 —— 标签不是"有则更好"的装饰，界面按它显示 chip，
    /// 静默空掉等于骗人。
    pub async fn attach_tags(
        &self,
        responses: &mut [super::response::TaskResponse],
    ) -> Result<(), ServiceError> {
        let ids: Vec<i32> = responses.iter().map(|response| response.id).collect();
        let mut tags = self
            .repo
            .tags_for_tasks(&ids)
            .await
            .map_err(ServiceError::Db)?;
        for response in responses.iter_mut() {
            response.tags = tags.remove(&response.id).unwrap_or_default();
        }
        Ok(())
    }

    pub async fn detail(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<Option<super::dto::TaskDetailResponse>, ServiceError> {
        self.repo
            .find_detail(actor, id)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn tree(&self, actor: &Actor, root: Option<i32>) -> Result<Vec<Task>, ServiceError> {
        self.repo
            .find_tree(actor, root)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn stats(&self, actor: &Actor) -> Result<(i64, i64, i64, i64), ServiceError> {
        self.repo.get_stats(actor).await.map_err(ServiceError::Db)
    }

    pub async fn by_status(
        &self,
        actor: &Actor,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .find_by_status_paginated(actor, status, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn search(
        &self,
        actor: &Actor,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), ServiceError> {
        self.repo
            .search_by_title_paginated(actor, query, limit, offset)
            .await
            .map_err(ServiceError::Db)
    }

    /// 获取日历事件 - 查询指定时间范围内的所有非归档任务的时间窗口
    pub async fn calendar(
        &self,
        actor: &Actor,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TimeWindow)>, ServiceError> {
        self.repo
            .find_calendar_events(actor, start, end, status)
            .await
            .map_err(ServiceError::Db)
    }

    /// 构建依赖图（DAG）— 批量查询，避免 N+1
    pub async fn dag(
        &self,
        actor: &Actor,
        root_task_id: Option<i32>,
        depth: i32,
    ) -> Result<super::response::DagView, ServiceError> {
        use super::response::{DagEdge, DagNode, DagView};
        use std::collections::{HashMap, HashSet, VecDeque};

        let (all_tasks, _) = self
            .repo
            .find_all_paginated(actor, 10000, 0)
            .await
            .map_err(ServiceError::Db)?;
        let task_map: HashMap<i32, &Task> = all_tasks.iter().map(|t| (t.id, t)).collect();

        // 批量取全部依赖
        let all_deps = self
            .repo
            .get_all_dependencies(actor)
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
        actor: &Actor,
        q: &str,
        limit: i64,
    ) -> Result<Vec<SearchHit>, ServiceError> {
        let Some((like, kw, cap)) = normalize_search(q, limit) else {
            return Ok(vec![]);
        };
        // 3+字符使用FTS5，短查询退化为LIKE
        let (rows, is_fts) = if let Some(fts) = fts_query(q) {
            (
                self.repo
                    .search_hits_fts(actor, &fts, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                true,
            )
        } else {
            (
                self.repo
                    .search_hits(actor, &like, cap)
                    .await
                    .map_err(ServiceError::Db)?,
                false,
            )
        };
        Ok(rows
            .into_iter()
            .map(|r| SearchHit {
                kind: "task".into(),
                id: r.id,
                title: r.title,
                snippet: snippet(r.description.as_deref().unwrap_or(""), kw),
                target: SearchTarget::Task { id: r.id },
                score: if is_fts { 1.0 } else { r.title_hit as f64 },
            })
            .collect())
    }
}
