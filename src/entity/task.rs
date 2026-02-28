use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "task")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    #[sea_orm(column_type = "Text")]
    pub title: String,

    #[sea_orm(column_type = "Text", nullable)]
    pub description: Option<String>,

    pub created_at: DateTimeUtc,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        has_many = "super::task_time_allocation::Entity",
    )]
    TaskTimeAllocations,

    #[sea_orm(
        has_many = "super::task_decomposition::Entity",
        from = "Column::Id",
        to = "super::task_decomposition::Column::ParentTaskId"
    )]
    ParentTaskDecompositions,

    #[sea_orm(
        has_many = "super::task_decomposition::Entity",
        from = "Column::Id",
        to = "super::task_decomposition::Column::SubTaskId"
    )]
    SubTaskDecompositions,

    #[sea_orm(
        has_many = "super::task_dependency::Entity",
        from = "Column::Id",
        to = "super::task_dependency::Column::TaskId"
    )]
    TaskDependencies,

    #[sea_orm(
        has_many = "super::task_dependency::Entity",
        from = "Column::Id",
        to = "super::task_dependency::Column::PrerequisiteId"
    )]
    PrerequisiteDependencies,
}



impl Related<super::time_window::Entity> for Entity {
    fn to() -> RelationDef {
        super::task_time_allocation::Relation::TimeWindow.def()
    }
}

impl Related<super::task_decomposition::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ParentTaskDecompositions.def()
    }
}

impl Related<super::task_dependency::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TaskDependencies.def()
    }
}

impl Related<super::task_time_allocation::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::TaskTimeAllocations.def()
    }
}

// 自关联关系通过中间表实现
impl Related<Entity> for Entity {
    fn to() -> RelationDef {
        // 通过任务分解表实现自关联
        Relation::ParentTaskDecompositions.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
