use chrono::{DateTime, Utc};
use std::sync::Arc;

use super::dto::{CreateTaskRequest, QuickCreateTaskRequest, UpdateTaskRequest};
use super::model::{Task, TaskStatus, TimeWindow, TimeWindowType};
use super::repository::TaskRepository;

#[derive(Clone)]
pub struct TaskService {
    repo: TaskRepository,
}

impl TaskService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: TaskRepository::new(db),
        }
    }

    pub async fn list(&self, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo
            .find_all_excluding_archived_paginated(limit, offset)
            .await
    }

    pub async fn list_all(&self, limit: i64, offset: i64) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo.find_all_paginated(limit, offset).await
    }

    pub async fn by_id(&self, id: i32) -> Result<Option<Task>, sqlx::Error> {
        self.repo.find_by_id(id).await
    }

    pub async fn detail(
        &self,
        id: i32,
    ) -> Result<Option<super::dto::TaskDetailResponse>, sqlx::Error> {
        self.repo.find_detail(id).await
    }

    pub async fn tree(&self, root: Option<i32>) -> Result<Vec<Task>, sqlx::Error> {
        self.repo.find_tree(root).await
    }

    pub async fn stats(&self) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        self.repo.get_stats().await
    }

    pub async fn by_status(
        &self,
        status: TaskStatus,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo
            .find_by_status_paginated(status, limit, offset)
            .await
    }

    pub async fn search(
        &self,
        query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Task>, i64), sqlx::Error> {
        self.repo
            .search_by_title_paginated(query, limit, offset)
            .await
    }

    pub async fn create(&self, req: CreateTaskRequest) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        validate_effort(req.effort_estimate_minutes)?;
        if let Some(parent_id) = req.parent_task_id {
            check_circular_parent(&self.repo, 0, parent_id).await?;
        }
        self.repo.create(req).await.map_err(ServiceError::Db)
    }

    pub async fn quick_create(&self, req: QuickCreateTaskRequest) -> Result<Task, ServiceError> {
        validate_title(&req.title)?;
        self.repo.quick_create(req).await.map_err(ServiceError::Db)
    }

    pub async fn update(&self, id: i32, req: UpdateTaskRequest) -> Result<Task, ServiceError> {
        if let Some(ref title) = req.title {
            validate_title(title)?;
        }
        if let Some(Some(minutes)) = req.effort_estimate_minutes {
            validate_effort(Some(minutes))?;
        }
        if let Some(Some(parent_id)) = req.parent_task_id {
            if parent_id == id {
                return Err(ServiceError::InvalidInput("不能设置自己为父任务".into()));
            }
            check_circular_parent(&self.repo, id, parent_id).await?;
        }
        self.repo.update(id, req).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn complete(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.complete(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn activate(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.activate(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn archive(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.archive(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, ServiceError> {
        self.repo.move_to_backlog(id).await.map_err(|e| match e {
            sqlx::Error::RowNotFound => ServiceError::NotFound("任务不存在".into()),
            other => ServiceError::from(other),
        })
    }

    pub async fn delete(&self, id: i32) -> Result<u64, ServiceError> {
        self.repo.delete(id).await.map_err(ServiceError::Db)
    }

    pub async fn add_dependency(&self, task_id: i32, depends_on: i32) -> Result<(), ServiceError> {
        if task_id == depends_on {
            return Err(ServiceError::InvalidInput("不能依赖自己".into()));
        }
        self.repo
            .add_dependency(task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    pub async fn remove_dependency(
        &self,
        task_id: i32,
        depends_on: i32,
    ) -> Result<u64, ServiceError> {
        self.repo
            .remove_dependency(task_id, depends_on)
            .await
            .map_err(ServiceError::Db)
    }

    /// 获取日历事件 - 查询指定时间范围内的所有非归档任务的时间窗口
    pub async fn calendar(
        &self,
        start: Option<DateTime<Utc>>,
        end: Option<DateTime<Utc>>,
        status: Option<TaskStatus>,
    ) -> Result<Vec<(Task, TimeWindow)>, ServiceError> {
        self.repo
            .find_calendar_events(start, end, status)
            .await
            .map_err(ServiceError::Db)
    }

    /// 校验时间窗口约束（C001 + C002）
    /// 在创建/更新 time_window 或更新任务的 time_windows 时调用
    pub async fn validate_time_windows(
        &self,
        task_id: i32,
        time_windows: &[TimeWindow],
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError> {
        // 获取任务已有的 available slots 和 planned slots
        let existing = self
            .repo
            .find_time_windows_by_task(task_id)
            .await
            .map_err(ServiceError::Db)?;

        let mut all_feasible: Vec<&TimeWindow> = Vec::new();
        let mut all_planned: Vec<&TimeWindow> = Vec::new();
        let mut all_actual: Vec<&TimeWindow> = Vec::new();

        for w in &existing {
            match w.window_type {
                TimeWindowType::Feasible => all_feasible.push(w),
                TimeWindowType::Planned => all_planned.push(w),
                TimeWindowType::Actual => all_actual.push(w),
            }
        }

        // 合并新时间段
        for w in time_windows {
            match w.window_type {
                TimeWindowType::Feasible => all_feasible.push(w),
                TimeWindowType::Planned => all_planned.push(w),
                TimeWindowType::Actual => all_actual.push(w),
            }
        }

        // C002: 检查同类型时间段不重叠
        let check_overlap =
            |windows: &[&TimeWindow], type_name: &str| -> Result<(), ServiceError> {
                for i in 0..windows.len() {
                    for j in (i + 1)..windows.len() {
                        let a = windows[i];
                        let b = windows[j];
                        // 跳过同一个 exclude_id 的情况（更新已有窗口时）
                        // 仅比较已入库的 ID（>0），新窗口 id=0 不会被误跳过
                        if let Some(eid) = exclude_id
                            && eid > 0
                            && (a.id == eid || b.id == eid)
                        {
                            continue;
                        }
                        if a.start_time < b.end_time && b.start_time < a.end_time {
                            return Err(ServiceError::InvalidInput(format!(
                                "{} 时间段 [{}, {}] 与 [{}, {}] 重叠",
                                type_name, a.start_time, a.end_time, b.start_time, b.end_time
                            )));
                        }
                    }
                }
                Ok(())
            };

        check_overlap(&all_feasible, "feasible")?;
        check_overlap(&all_planned, "planned")?;
        check_overlap(&all_actual, "actual")?;

        // C001: planned 必须在 feasible 内部
        for planned in &all_planned {
            let covered = all_feasible
                .iter()
                .any(|f| f.start_time <= planned.start_time && f.end_time >= planned.end_time);
            if !covered {
                return Err(ServiceError::InvalidInput(format!(
                    "计划时间段 [{}, {}] 不在任何可行时间窗口内",
                    planned.start_time, planned.end_time
                )));
            }
        }

        Ok(())
    }

    /// 构建依赖图（DAG）— 批量查询，避免 N+1
    pub async fn dag(
        &self,
        root_task_id: Option<i32>,
        depth: i32,
    ) -> Result<super::response::DagView, ServiceError> {
        use super::response::{DagEdge, DagNode, DagView};
        use std::collections::{HashMap, HashSet, VecDeque};

        let (all_tasks, _) = self
            .repo
            .find_all_paginated(10000, 0)
            .await
            .map_err(ServiceError::Db)?;
        let task_map: HashMap<i32, &Task> = all_tasks.iter().map(|t| (t.id, t)).collect();

        // 批量取全部依赖
        let all_deps = self
            .repo
            .get_all_dependencies()
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

fn validate_title(title: &str) -> Result<(), ServiceError> {
    if title.is_empty() || title.len() > 255 {
        return Err(ServiceError::InvalidInput(
            "标题长度必须在1-255字符之间".into(),
        ));
    }
    Ok(())
}

fn validate_effort(minutes: Option<i32>) -> Result<(), ServiceError> {
    if let Some(m) = minutes
        && m < 0
    {
        return Err(ServiceError::InvalidInput("精力估算值不能为负数".into()));
    }
    Ok(())
}

async fn check_circular_parent(
    repo: &TaskRepository,
    task_id: i32,
    parent_id: i32,
) -> Result<(), ServiceError> {
    let is_circular = repo
        .check_circular_parent(task_id, parent_id)
        .await
        .map_err(ServiceError::Db)?;
    if is_circular {
        return Err(ServiceError::InvalidInput("检测到父子循环引用".into()));
    }
    Ok(())
}

pub use crate::error::ServiceError;

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    // ── validate_title ──

    #[test]
    fn title_valid() {
        assert!(validate_title("My Task").is_ok());
    }

    #[test]
    fn title_empty() {
        let err = validate_title("").unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[test]
    fn title_too_long() {
        let long = "a".repeat(256);
        let err = validate_title(&long).unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[test]
    fn title_exactly_255_chars() {
        let ok = "a".repeat(255);
        assert!(validate_title(&ok).is_ok());
    }

    #[test]
    fn title_single_char() {
        assert!(validate_title("x").is_ok());
    }

    #[test]
    fn title_whitespace_only() {
        // 空白字符串 trim 后为空——但 validate_title 不做 trim，
        // 所以 "   " 不算 empty，长度 3，预期 ok
        assert!(validate_title("   ").is_ok());
    }

    // ── validate_effort ──

    #[test]
    fn effort_none_is_valid() {
        assert!(validate_effort(None).is_ok());
    }

    #[test]
    fn effort_zero_is_valid() {
        assert!(validate_effort(Some(0)).is_ok());
    }

    #[test]
    fn effort_positive_is_valid() {
        assert!(validate_effort(Some(30)).is_ok());
        assert!(validate_effort(Some(1)).is_ok());
        assert!(validate_effort(Some(9999)).is_ok());
    }

    #[test]
    fn effort_negative_is_invalid() {
        let err = validate_effort(Some(-1)).unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
        let err2 = validate_effort(Some(-999)).unwrap_err();
        assert!(matches!(err2, ServiceError::InvalidInput(_)));
    }

    // ── ServiceError display ──

    #[test]
    fn service_error_invalid_input_display() {
        let e = ServiceError::InvalidInput("标题太短".into());
        assert_eq!(format!("{}", e), "标题太短");
    }

    #[test]
    fn service_error_not_found_display() {
        let e = ServiceError::NotFound("任务不存在".into());
        assert_eq!(format!("{}", e), "任务不存在");
    }

    #[test]
    fn service_error_circular_parent_display() {
        let e = ServiceError::InvalidInput("检测到父子循环引用".into());
        assert_eq!(format!("{}", e), "检测到父子循环引用");
    }

    #[test]
    fn service_error_self_parent_display() {
        let e = ServiceError::InvalidInput("不能设置自己为父任务".into());
        assert_eq!(format!("{}", e), "不能设置自己为父任务");
    }

    #[test]
    fn service_error_self_dependency_display() {
        let e = ServiceError::InvalidInput("不能依赖自己".into());
        assert_eq!(format!("{}", e), "不能依赖自己");
    }

    #[test]
    fn service_error_planned_outside_available_display() {
        let e = ServiceError::InvalidInput("超出范围".into());
        assert!(format!("{}", e).contains("超出"));
    }

    #[test]
    fn service_error_slot_overlap_display() {
        let e = ServiceError::InvalidInput("重叠".into());
        assert!(format!("{}", e).contains("重叠"));
    }

    // ── ServiceError::into_response ──
    // 只验证不 panic，不校验具体 HTTP 响应体结构

    #[test]
    fn service_error_into_response_does_not_panic() {
        let errors = vec![
            ServiceError::InvalidInput("测试".into()),
            ServiceError::NotFound("任务不存在".into()),
            ServiceError::InvalidInput("检测到父子循环引用".into()),
            ServiceError::InvalidInput("不能设置自己为父任务".into()),
            ServiceError::InvalidInput("不能依赖自己".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::InvalidInput("测试".into()),
            ServiceError::from(sqlx::Error::Protocol("测试".into())),
        ];
        for e in errors {
            let _ = e.into_response();
        }
    }
}
