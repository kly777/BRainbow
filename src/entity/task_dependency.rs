use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "task_dependency")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub task_id: i32,
    
    #[sea_orm(primary_key)]
    pub prerequisite_id: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::TaskId",
        to = "super::task::Column::Id"
    )]
    Task,
    
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::PrerequisiteId",
        to = "super::task::Column::Id"
    )]
    PrerequisiteTask,
}

impl Related<super::task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Task.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}