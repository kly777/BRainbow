use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize, Deserialize)]
#[sea_orm(table_name = "task_time_allocation")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub task_id: i32,
    
    #[sea_orm(primary_key)]
    pub time_window_id: i32,
    
    #[sea_orm(primary_key)]
    pub allocation_type: i32,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::task::Entity",
        from = "Column::TaskId",
        to = "super::task::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    Task,
    
    #[sea_orm(
        belongs_to = "super::time_window::Entity",
        from = "Column::TimeWindowId",
        to = "super::time_window::Column::Id",
        on_update = "NoAction",
        on_delete = "Cascade"
    )]
    TimeWindow,
}

impl Related<super::task::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Task.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}