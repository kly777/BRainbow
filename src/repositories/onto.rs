use sea_orm::{DatabaseConnection, EntityTrait, Set, ActiveModelTrait, DeleteResult, QueryFilter, ColumnTrait};
use std::sync::Arc;

use crate::entity::onto;

/// 本体数据访问层
pub struct OntoRepository {
    db: Arc<DatabaseConnection>,
}

impl OntoRepository {
    /// 创建新的本体数据访问层实例
    pub fn new(db: Arc<DatabaseConnection>) -> Self {
        Self { db }
    }

    /// 获取所有本体
    pub async fn find_all(&self) -> Result<Vec<onto::Model>, sea_orm::DbErr> {
        onto::Entity::find().all(&*self.db).await
    }

    /// 根据ID获取本体
    pub async fn find_by_id(&self, id: i32) -> Result<Option<onto::Model>, sea_orm::DbErr> {
        onto::Entity::find_by_id(id).one(&*self.db).await
    }

    /// 创建本体
    pub async fn create(&self, name: String) -> Result<onto::Model, sea_orm::DbErr> {
        let new_onto = onto::ActiveModel {
            name: Set(name.clone()),
            ..Default::default()
        };

        let result = onto::Entity::insert(new_onto).exec(&*self.db).await?;
        
        // 获取刚创建的本体
        onto::Entity::find_by_id(result.last_insert_id)
            .one(&*self.db)
            .await
            .map(|opt| opt.expect("刚刚创建的本体应该存在"))
    }

    /// 更新本体
    pub async fn update(&self, id: i32, name: Option<String>) -> Result<Option<onto::Model>, sea_orm::DbErr> {
        // 先查找本体
        let onto = match onto::Entity::find_by_id(id).one(&*self.db).await? {
            Some(onto) => onto,
            None => return Ok(None),
        };

        // 更新字段
        let mut onto_active: onto::ActiveModel = onto.into();
        if let Some(name) = name {
            onto_active.name = Set(name);
        }

        // 保存更新
        onto_active.update(&*self.db).await?;

        // 返回更新后的本体
        onto::Entity::find_by_id(id).one(&*self.db).await
    }

    /// 删除本体
    pub async fn delete(&self, id: i32) -> Result<DeleteResult, sea_orm::DbErr> {
        onto::Entity::delete_by_id(id).exec(&*self.db).await
    }

    /// 根据名称查找本体
    pub async fn find_by_name(&self, name: &str) -> Result<Option<onto::Model>, sea_orm::DbErr> {
        onto::Entity::find()
            .filter(onto::Column::Name.eq(name))
            .one(&*self.db)
            .await
    }
}