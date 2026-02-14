use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, DeleteResult, EntityTrait, PaginatorTrait,
    QueryFilter, Set,
};
use std::sync::Arc;

use crate::entity::signifier_signified;

/// 符号关系数据访问层
pub struct SignRepository {
    db: Arc<DatabaseConnection>,
}

impl SignRepository {
    /// 创建新的符号关系数据访问层实例
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// 获取所有符号关系
    pub async fn find_all(&self) -> Result<Vec<signifier_signified::Model>, sea_orm::DbErr> {
        signifier_signified::Entity::find().all(&*self.db).await
    }

    /// 根据ID获取符号关系
    pub async fn find_by_id(
        &self,
        id: i32,
    ) -> Result<Option<signifier_signified::Model>, sea_orm::DbErr> {
        signifier_signified::Entity::find_by_id(id)
            .one(&*self.db)
            .await
    }

    /// 创建符号关系
    pub async fn create(
        &self,
        signifier_id: i32,
        signified_id: i32,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> Result<signifier_signified::Model, sea_orm::DbErr> {
        let new_sign = signifier_signified::ActiveModel {
            signifier_id: Set(signifier_id),
            signified_id: Set(signified_id),
            weight: Set(weight),
            relation_type: Set(relation_type),
            ..Default::default()
        };

        let result = signifier_signified::Entity::insert(new_sign)
            .exec(&*self.db)
            .await?;

        // 获取刚创建的符号关系
        signifier_signified::Entity::find_by_id(result.last_insert_id)
            .one(&*self.db)
            .await
            .map(|opt| opt.expect("刚刚创建的符号关系应该存在"))
    }

    /// 删除符号关系
    pub async fn delete(&self, id: i32) -> Result<DeleteResult, sea_orm::DbErr> {
        signifier_signified::Entity::delete_by_id(id)
            .exec(&*self.db)
            .await
    }

    /// 根据能指ID获取符号关系
    pub async fn find_by_signifier_id(
        &self,
        signifier_id: i32,
    ) -> Result<Vec<signifier_signified::Model>, sea_orm::DbErr> {
        signifier_signified::Entity::find()
            .filter(signifier_signified::Column::SignifierId.eq(signifier_id))
            .all(&*self.db)
            .await
    }

    /// 根据所指ID获取符号关系
    pub async fn find_by_signified_id(
        &self,
        signified_id: i32,
    ) -> Result<Vec<signifier_signified::Model>, sea_orm::DbErr> {
        signifier_signified::Entity::find()
            .filter(signifier_signified::Column::SignifiedId.eq(signified_id))
            .all(&*self.db)
            .await
    }

    /// 检查符号关系是否存在
    pub async fn exists(
        &self,
        signifier_id: i32,
        signified_id: i32,
    ) -> Result<bool, sea_orm::DbErr> {
        let count = signifier_signified::Entity::find()
            .filter(signifier_signified::Column::SignifierId.eq(signifier_id))
            .filter(signifier_signified::Column::SignifiedId.eq(signified_id))
            .count(&*self.db)
            .await?;

        Ok(count > 0)
    }

    /// 获取符号关系数量
    pub async fn count(&self) -> Result<u64, sea_orm::DbErr> {
        signifier_signified::Entity::find().count(&*self.db).await
    }
}
