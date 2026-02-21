use sea_orm::entity::prelude::*;
use serde::Serialize;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Serialize)]
#[sea_orm(table_name = "card")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,
    
    pub title: String,
    
    pub content: String,
    
    pub created_at: DateTimeUtc,
    
    pub updated_at: DateTimeUtc,
}

impl ActiveModelBehavior for ActiveModel {}