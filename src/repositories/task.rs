use std::sync::Arc;

use sea_orm::{
    prelude::*,
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};

use crate::entity::{
    task::{self, Entity, Model},
    task_decomposition, task_dependency, task_time_allocation, time_window,
};

/// 任务数据仓库
#[derive(Clone)]
pub struct TaskRepository {
    db: Arc<DatabaseConnection>,
}

impl TaskRepository {
    /// 创建新的任务仓库实例
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// 获取所有任务
    pub async fn find_all(&self) -> Result<Vec<Model>, DbErr> {
        Entity::find()
            .order_by_asc(task::Column::Id)
            .all(self.db.as_ref())
            .await
    }

    /// 根据ID查找任务
    pub async fn find_by_id(&self, id: i32) -> Result<Option<Model>, DbErr> {
        Entity::find_by_id(id).one(self.db.as_ref()).await
    }

    /// 创建新任务
    pub async fn create(
        &self,
        title: String,
        description: Option<String>,
    ) -> Result<Model, DbErr> {
        let active_model = task::ActiveModel {
            title: Set(title),
            description: Set(description),
            created_at: Set(chrono::Utc::now()),
            ..Default::default()
        };

        active_model.insert(self.db.as_ref()).await
    }

    /// 更新任务
    pub async fn update(
        &self,
        id: i32,
        title: Option<String>,
        description: Option<Option<String>>,
    ) -> Result<Model, DbErr> {
        let task = self.find_by_id(id).await?.ok_or(DbErr::RecordNotFound(
            format!("Task with id {} not found", id),
        ))?;

        let mut active_model: task::ActiveModel = task.into();

        if let Some(title) = title {
            active_model.title = Set(title);
        }

        if let Some(description) = description {
            active_model.description = Set(description);
        }

        active_model.update(self.db.as_ref()).await
    }

    /// 删除任务
    pub async fn delete(&self, id: i32) -> Result<(), DbErr> {
        let task = self.find_by_id(id).await?.ok_or(DbErr::RecordNotFound(
            format!("Task with id {} not found", id),
        ))?;

        let active_model: task::ActiveModel = task.into();
        active_model.delete(self.db.as_ref()).await?;

        Ok(())
    }

    /// 获取任务分配的时间窗口
    pub async fn find_time_windows(&self, task_id: i32) -> Result<Vec<time_window::Model>, DbErr> {
        let allocations = task_time_allocation::Entity::find()
            .filter(task_time_allocation::Column::TaskId.eq(task_id))
            .all(self.db.as_ref())
            .await?;

        let time_window_ids: Vec<i32> = allocations
            .into_iter()
            .map(|model| model.time_window_id)
            .collect();

        if time_window_ids.is_empty() {
            return Ok(vec![]);
        }

        time_window::Entity::find()
            .filter(time_window::Column::Id.is_in(time_window_ids))
            .all(self.db.as_ref())
            .await
    }

    /// 获取任务的父任务
    pub async fn find_parent_tasks(&self, task_id: i32) -> Result<Vec<Model>, DbErr> {
        let sub_tasks = task_decomposition::Entity::find()
            .filter(task_decomposition::Column::SubTaskId.eq(task_id))
            .all(self.db.as_ref())
            .await?;

        let parent_ids: Vec<i32> = sub_tasks
            .into_iter()
            .map(|model| model.parent_task_id)
            .collect();

        if parent_ids.is_empty() {
            return Ok(vec![]);
        }

        Entity::find()
            .filter(task::Column::Id.is_in(parent_ids))
            .all(self.db.as_ref())
            .await
    }

    /// 获取任务的子任务
    pub async fn find_sub_tasks(&self, task_id: i32) -> Result<Vec<Model>, DbErr> {
        let parent_tasks = task_decomposition::Entity::find()
            .filter(task_decomposition::Column::ParentTaskId.eq(task_id))
            .all(self.db.as_ref())
            .await?;

        let sub_task_ids: Vec<i32> = parent_tasks
            .into_iter()
            .map(|model| model.sub_task_id)
            .collect();

        if sub_task_ids.is_empty() {
            return Ok(vec![]);
        }

        Entity::find()
            .filter(task::Column::Id.is_in(sub_task_ids))
            .all(self.db.as_ref())
            .await
    }

    /// 获取任务依赖的其他任务（需要等待的任务）
    pub async fn find_dependencies(&self, task_id: i32) -> Result<Vec<Model>, DbErr> {
        let dependencies = task_dependency::Entity::find()
            .filter(task_dependency::Column::TaskId.eq(task_id))
            .all(self.db.as_ref())
            .await?;

        let prerequisite_ids: Vec<i32> = dependencies
            .into_iter()
            .map(|model| model.prerequisite_id)
            .collect();

        if prerequisite_ids.is_empty() {
            return Ok(vec![]);
        }

        Entity::find()
            .filter(task::Column::Id.is_in(prerequisite_ids))
            .all(self.db.as_ref())
            .await
    }

    /// 获取依赖此任务的其他任务（被依赖的任务）
    pub async fn find_dependents(&self, task_id: i32) -> Result<Vec<Model>, DbErr> {
        let dependents = task_dependency::Entity::find()
            .filter(task_dependency::Column::PrerequisiteId.eq(task_id))
            .all(self.db.as_ref())
            .await?;

        let dependent_ids: Vec<i32> = dependents
            .into_iter()
            .map(|model| model.task_id)
            .collect();

        if dependent_ids.is_empty() {
            return Ok(vec![]);
        }

        Entity::find()
            .filter(task::Column::Id.is_in(dependent_ids))
            .all(self.db.as_ref())
            .await
    }

    /// 添加时间窗口分配
    pub async fn add_time_window(
        &self,
        task_id: i32,
        time_window_id: i32,
        allocation_type: i32,
    ) -> Result<(), DbErr> {
        let active_model = task_time_allocation::ActiveModel {
            task_id: Set(task_id),
            time_window_id: Set(time_window_id),
            allocation_type: Set(allocation_type),
        };

        active_model.insert(self.db.as_ref()).await?;
        Ok(())
    }

    /// 移除时间窗口分配
    pub async fn remove_time_window(
        &self,
        task_id: i32,
        time_window_id: i32,
        allocation_type: i32,
    ) -> Result<(), DbErr> {
        task_time_allocation::Entity::delete_by_id((task_id, time_window_id, allocation_type))
            .exec(self.db.as_ref())
            .await?;

        Ok(())
    }

    /// 添加子任务
    pub async fn add_sub_task(&self, parent_task_id: i32, sub_task_id: i32) -> Result<(), DbErr> {
        let active_model = task_decomposition::ActiveModel {
            parent_task_id: Set(parent_task_id),
            sub_task_id: Set(sub_task_id),
        };

        active_model.insert(self.db.as_ref()).await?;
        Ok(())
    }

    /// 移除子任务
    pub async fn remove_sub_task(
        &self,
        parent_task_id: i32,
        sub_task_id: i32,
    ) -> Result<(), DbErr> {
        task_decomposition::Entity::delete_by_id((parent_task_id, sub_task_id))
            .exec(self.db.as_ref())
            .await?;

        Ok(())
    }

    /// 添加任务依赖
    pub async fn add_dependency(&self, task_id: i32, prerequisite_id: i32) -> Result<(), DbErr> {
        let active_model = task_dependency::ActiveModel {
            task_id: Set(task_id),
            prerequisite_id: Set(prerequisite_id),
        };

        active_model.insert(self.db.as_ref()).await?;
        Ok(())
    }

    /// 移除任务依赖
    pub async fn remove_dependency(&self, task_id: i32, prerequisite_id: i32) -> Result<(), DbErr> {
        task_dependency::Entity::delete_by_id((task_id, prerequisite_id))
            .exec(self.db.as_ref())
            .await?;

        Ok(())
    }

    /// 统计任务数量
    pub async fn count(&self) -> Result<u64, DbErr> {
        Entity::find().count(self.db.as_ref()).await
    }

    /// 根据标题搜索任务
    pub async fn search_by_title(&self, title_query: &str) -> Result<Vec<Model>, DbErr> {
        Entity::find()
            .filter(task::Column::Title.contains(title_query))
            .order_by_asc(task::Column::Id)
            .all(self.db.as_ref())
            .await
    }

    /// 获取最近创建的任务
    pub async fn find_recent(&self, limit: u64) -> Result<Vec<Model>, DbErr> {
        Entity::find()
            .order_by_desc(task::Column::CreatedAt)
            .limit(limit)
            .all(self.db.as_ref())
            .await
    }
}