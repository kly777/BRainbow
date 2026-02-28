use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "task_decomposition")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub parent_task_id: i32,
    
    #[sea_orm(primary_key)]
    pub sub_task_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::ParentTaskId",
        to = "super::task::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    ParentTask,
    
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::SubTaskId",
        to = "super::task::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    SubTask,
}

impl Related<super::task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::ParentTask.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}