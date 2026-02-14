use sea_orm::{DatabaseConnection, EntityTrait, PaginatorTrait,Set,DeleteResult,QueryFilter,ColumnTrait};
use std::sync::Arc;

use crate::entity::user;

/// 用户数据访问层
pub struct UserRepository {
    db: Arc<DatabaseConnection>,
}

impl UserRepository {
    /// 创建新的用户数据访问层实例
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// 获取所有用户
    pub async fn find_all(&self) -> Result<Vec<user::Model>, sea_orm::DbErr> {
        user::Entity::find().all(&*self.db).await
    }

    /// 根据ID获取用户
    pub async fn find_by_id(&self, id: i32) -> Result<Option<user::Model>, sea_orm::DbErr> {
        user::Entity::find_by_id(id).one(&*self.db).await
    }

    /// 创建用户
    pub async fn create(&self, name: String) -> Result<user::Model, sea_orm::DbErr> {
        let new_user = user::ActiveModel {
            name: Set(name.clone()),
            ..Default::default()
        };

        let result = user::Entity::insert(new_user).exec(&*self.db).await?;

        // 获取刚创建的用户
        user::Entity::find_by_id(result.last_insert_id)
            .one(&*self.db)
            .await
            .map(|opt| opt.expect("刚刚创建的用户应该存在"))
    }

    /// 根据名称查找用户
    pub async fn find_by_name(&self, name: &str) -> Result<Option<user::Model>, sea_orm::DbErr> {
        user::Entity::find()
            .filter(user::Column::Name.eq(name))
            .one(&*self.db)
            .await
    }

    /// 删除用户
    pub async fn delete(&self, id: i32) -> Result<DeleteResult, sea_orm::DbErr> {
        user::Entity::delete_by_id(id).exec(&*self.db).await
    }

    /// 获取用户数量
    pub async fn count(&self) -> Result<u64, sea_orm::DbErr> {
        user::Entity::find().count(&*self.db).await
    }

    /// 检查用户是否存在
    pub async fn exists(&self, id: i32) -> Result<bool, sea_orm::DbErr> {
        let count = user::Entity::find_by_id(id).count(&*self.db).await?;
        Ok(count > 0)
    }
}
