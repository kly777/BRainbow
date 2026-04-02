use std::sync::Arc;

use crate::entity::Task;
use crate::repos::task::TaskRepository;

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
    pub async fn create_task(&self, title: String, description: Option<String>, user_id: Option<i32>) -> Result<Task, String> {
        // 验证标题是否为空
        if title.trim().is_empty() {
            return Err("任务标题不能为空".to_string());
        }

        // 创建任务
        self.task_repository
            .create(title, description, user_id)
            .await
            .map_err(|e| format!("创建任务失败: {}", e))
    }

    /// 更新任务
    pub async fn update_task(&self, id: i32, title: Option<String>, description: Option<String>, status: Option<String>, priority: Option<i32>, user_id: Option<i32>) -> Result<Task, String> {
        // 验证标题是否为空（如果提供了标题）
        if let Some(ref title) = title {
            if title.trim().is_empty() {
                return Err("任务标题不能为空".to_string());
            }
        }

        // 更新任务
        self.task_repository
            .update(id, title, description, status, priority, user_id)
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

    // /// 根据用户ID获取任务
    // pub async fn get_tasks_by_user_id(&self, user_id: i32) -> Result<Vec<Task>, String> {
    //     self.task_repository
    //         .find_by_user_id(user_id)
    //         .await
    //         .map_err(|e| format!("获取用户任务失败: {}", e))
    // }

    // /// 获取任务数量
    // pub async fn get_task_count(&self) -> Result<i64, String> {
    //     self.task_repository
    //         .count()
    //         .await
    //         .map_err(|e| format!("获取任务数量失败: {}", e))
    // }

    // /// 检查任务是否存在
    // pub async fn task_exists(&self, id: i32) -> Result<bool, String> {
    //     self.task_repository
    //         .exists(id)
    //         .await
    //         .map_err(|e| format!("检查任务存在失败: {}", e))
    // }

    // /// 获取任务依赖
    // pub async fn get_task_dependencies(&self, task_id: i32) -> Result<Vec<crate::entity::TaskDependency>, String> {
    //     self.task_repository
    //         .find_dependencies(task_id)
    //         .await
    //         .map_err(|e| format!("获取任务依赖失败: {}", e))
    // }

    // /// 获取任务分解
    // pub async fn get_task_decompositions(&self, task_id: i32) -> Result<Vec<crate::entity::TaskDecomposition>, String> {
    //     self.task_repository
    //         .find_decompositions(task_id)
    //         .await
    //         .map_err(|e| format!("获取任务分解失败: {}", e))
    // }

    // /// 获取任务时间分配
    // pub async fn get_task_time_allocations(&self, task_id: i32) -> Result<Vec<crate::entity::TaskTimeAllocation>, String> {
    //     self.task_repository
    //         .find_time_allocations(task_id)
    //         .await
    //         .map_err(|e| format!("获取任务时间分配失败: {}", e))
    // }

    // /// 添加任务依赖
    // pub async fn add_task_dependency(&self, task_id: i32, depends_on_task_id: i32) -> Result<crate::entity::TaskDependency, String> {
    //     self.task_repository
    //         .add_dependency(task_id, depends_on_task_id)
    //         .await
    //         .map_err(|e| format!("添加任务依赖失败: {}", e))
    // }

    // /// 添加任务分解
    // pub async fn add_task_decomposition(&self, parent_task_id: i32, child_task_id: i32) -> Result<crate::entity::TaskDecomposition, String> {
    //     self.task_repository
    //         .add_decomposition(parent_task_id, child_task_id)
    //         .await
    //         .map_err(|e| format!("添加任务分解失败: {}", e))
    // }

    // /// 添加任务时间分配
    // pub async fn add_task_time_allocation(&self, task_id: i32, time_window_id: i32, duration_minutes: i32) -> Result<crate::entity::TaskTimeAllocation, String> {
    //     self.task_repository
    //         .add_time_allocation(task_id, time_window_id, duration_minutes)
    //         .await
    //         .map_err(|e| format!("添加任务时间分配失败: {}", e))
    // }

    // /// 删除任务依赖
    // pub async fn remove_task_dependency(&self, id: i32) -> Result<u64, String> {
    //     self.task_repository
    //         .remove_dependency(id)
    //         .await
    //         .map_err(|e| format!("删除任务依赖失败: {}", e))
    // }

    // /// 删除任务分解
    // pub async fn remove_task_decomposition(&self, id: i32) -> Result<u64, String> {
    //     self.task_repository
    //         .remove_decomposition(id)
    //         .await
    //         .map_err(|e| format!("删除任务分解失败: {}", e))
    // }

    // /// 删除任务时间分配
    // pub async fn remove_task_time_allocation(&self, id: i32) -> Result<u64, String> {
    //     self.task_repository
    //         .remove_time_allocation(id)
    //         .await
    //         .map_err(|e| format!("删除任务时间分配失败: {}", e))
    // }
}
