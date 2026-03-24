use sea_orm::{
    ActiveModelTrait, DatabaseConnection, DeleteResult, EntityTrait, IntoActiveModel, Set,
};
use std::sync::Arc;

use crate::entity::card;

/// Card 数据访问层
pub struct CardRepository {
    db: Arc<DatabaseConnection>,
}

impl CardRepository {
    /// 创建新的 Card 数据访问层实例
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// 获取所有卡片
    pub async fn find_all(&self) -> Result<Vec<card::Model>, sea_orm::DbErr> {
        card::Entity::find().all(&*self.db).await
    }

    /// 根据ID获取卡片
    pub async fn find_by_id(&self, id: i32) -> Result<Option<card::Model>, sea_orm::DbErr> {
        card::Entity::find_by_id(id).one(&*self.db).await
    }

    /// 创建卡片
    pub async fn create(&self, title: String, content: String) -> Result<card::Model, sea_orm::DbErr> {
        let new_card = card::ActiveModel {
            title: Set(title),
            content: Set(content),
            ..Default::default()
        };

        let result = card::Entity::insert(new_card).exec(&*self.db).await?;

        // 获取刚创建的卡片
        card::Entity::find_by_id(result.last_insert_id)
            .one(&*self.db)
            .await
            .map(|opt| opt.expect("刚刚创建的卡片应该存在"))
    }

    /// 更新卡片
    pub async fn update(&self, id: i32, title: Option<String>, content: Option<String>) -> Result<card::Model, sea_orm::DbErr> {
        // 先查找现有的卡片
        let existing_card = card::Entity::find_by_id(id)
            .one(&*self.db)
            .await?
            .ok_or_else(|| sea_orm::DbErr::RecordNotFound(format!("Card with id {} not found", id)))?;

        // 转换为 ActiveModel
        let mut active_model = existing_card.into_active_model();

        // 更新字段（如果提供了新值）
        if let Some(title) = title {
            active_model.title = Set(title);
        }
        if let Some(content) = content {
            active_model.content = Set(content);
        }

        // 保存更新
        let updated_card = active_model.update(&*self.db).await?;
        Ok(updated_card)
    }

    /// 删除卡片
    pub async fn delete(&self, id: i32) -> Result<DeleteResult, sea_orm::DbErr> {
        card::Entity::delete_by_id(id).exec(&*self.db).await
    }
}