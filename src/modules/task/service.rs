use std::sync::Arc;

use super::dto::{CreateTaskRequest, UpdateTaskRequest};
use super::model::{Task, TaskStatus};
use super::repository::TaskRepository;

/// 任务服务层
pub struct TaskService {
    task_repository: TaskRepository,
}

impl TaskService {
    /// 创建新的任务服务层实例
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            task_repository: TaskRepository::new(db),
        }
    }

    /// 获取所有任务
    pub async fn get_all_tasks(&self) -> Result<Vec<Task>, String> {
        self.task_repository
            .find_all()
            .await
            .map_err(|e| format!("获取任务列表失败: {}", e))
    }

    /// 根据ID获取任务
    pub async fn get_task_by_id(&self, id: i32) -> Result<Option<Task>, String> {
        self.task_repository
            .find_by_id(id)
            .await
            .map_err(|e| format!("获取任务失败: {}", e))
    }

    /// 创建任务
    pub async fn create_task(&self, request: CreateTaskRequest) -> Result<Task, String> {
        // 验证标题是否为空
        if request.title.trim().is_empty() {
            return Err("任务标题不能为空".to_string());
        }

        // 创建任务
        self.task_repository
            .create(request)
            .await
            .map_err(|e| format!("创建任务失败: {}", e))
    }

    /// 快速创建任务
    pub async fn quick_create_task(&self, title: String, user_id: Option<i32>) -> Result<Task, String> {
        if title.trim().is_empty() {
            return Err("任务标题不能为空".to_string());
        }

        let request = CreateTaskRequest {
            title,
            description: None,
            parent_task_id: None,
            effort_estimate_minutes: None,
            user_id,
        };

        self.task_repository
            .create(request)
            .await
            .map_err(|e| format!("快速创建任务失败: {}", e))
    }

    /// 更新任务
    pub async fn update_task(&self, id: i32, request: UpdateTaskRequest) -> Result<Task, String> {
        // 验证标题是否为空（如果提供了标题）
        if let Some(ref title) = request.title {
            if title.trim().is_empty() {
                return Err("任务标题不能为空".to_string());
            }
        }

        // 更新任务
        self.task_repository
            .update(id, request)
            .await
            .map_err(|e| format!("更新任务失败: {}", e))
    }

    /// 删除任务
    pub async fn delete_task(&self, id: i32) -> Result<u64, String> {
        self.task_repository
            .delete(id)
            .await
            .map_err(|e| format!("删除任务失败: {}", e))
    }

    /// 开始任务
    pub async fn start_task(&self, id: i32) -> Result<Task, String> {
        let request = UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: Some(TaskStatus::Active),
            effort_estimate_minutes: None,
            user_id: None,
        };

        self.task_repository
            .update(id, request)
            .await
            .map_err(|e| format!("开始任务失败: {}", e))
    }

    /// 完成任务
    pub async fn complete_task(&self, id: i32) -> Result<Task, String> {
        let request = UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: Some(TaskStatus::Completed),
            effort_estimate_minutes: None,
            user_id: None,
        };

        self.task_repository
            .update(id, request)
            .await
            .map_err(|e| format!("完成任务失败: {}", e))
    }

    /// 归档任务
    pub async fn archive_task(&self, id: i32) -> Result<Task, String> {
        let request = UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: Some(TaskStatus::Archived),
            effort_estimate_minutes: None,
            user_id: None,
        };

        self.task_repository
            .update(id, request)
            .await
            .map_err(|e| format!("归档任务失败: {}", e))
    }

    /// 移动到待办列表
    pub async fn move_to_backlog(&self, id: i32) -> Result<Task, String> {
        let request = UpdateTaskRequest {
            title: None,
            description: None,
            parent_task_id: None,
            status: Some(TaskStatus::Backlog),
            effort_estimate_minutes: None,
            user_id: None,
        };

        self.task_repository
            .update(id, request)
            .await
            .map_err(|e| format!("移动任务到待办列表失败: {}", e))
    }

    /// 获取子任务
    pub async fn get_child_tasks(&self, task_id: i32) -> Result<Vec<Task>, String> {
        self.task_repository
            .find_tree(Some(task_id))
            .await
            .map_err(|e| format!("获取子任务失败: {}", e))
    }

    /// 获取任务依赖
    pub async fn get_task_dependencies(&self, task_id: i32) -> Result<Vec<i32>, String> {
        self.task_repository
            .get_dependencies(task_id)
            .await
            .map_err(|e| format!("获取任务依赖失败: {}", e))
    }

    /// 添加任务依赖
    pub async fn add_task_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<(), String> {
        self.task_repository
            .add_dependency(task_id, depends_on_task_id)
            .await
            .map_err(|e| format!("添加任务依赖失败: {}", e))
    }

    /// 删除任务依赖
    pub async fn remove_task_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<(), String> {
        self.task_repository
            .remove_dependency(task_id, depends_on_task_id)
            .await
            .map(|_| ())
            .map_err(|e| format!("删除任务依赖失败: {}", e))
    }

    /// 获取树形结构
    pub async fn get_task_tree(&self, root_task_id: Option<i32>) -> Result<Vec<Task>, String> {
        self.task_repository
            .find_tree(root_task_id)
            .await
            .map_err(|e| format!("获取任务树失败: {}", e))
    }

    /// 检查循环依赖
    pub async fn check_circular_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<bool, String> {
        self.task_repository
            .check_circular_parent(task_id, depends_on_task_id)
            .await
            .map_err(|e| format!("检查循环依赖失败: {}", e))
    }

    /// 检查父子循环
    pub async fn check_parent_child_cycle(&self, task_id: i32, parent_task_id: i32) -> Result<bool, String> {
        self.task_repository
            .check_circular_parent(task_id, parent_task_id)
            .await
            .map_err(|e| format!("检查父子循环失败: {}", e))
    }
}