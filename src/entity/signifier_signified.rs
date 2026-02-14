use sea_orm::entity::prelude::*;

/// 符号学中的能指与所指关系
#[sea_orm::compact_model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "signifier_signified")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    /// 能指 (signifier) 的 ID - 指向 onto 表
    #[sea_orm(column_name = "signifier_id")]
    pub signifier_id: i32,

    /// 所指 (signified) 的 ID - 指向 onto 表
    #[sea_orm(column_name = "signified_id")]
    pub signified_id: i32,

    /// 创建时间
    #[sea_orm(column_name = "created_at")]
    pub created_at: DateTime,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::onto::Entity",
        from = "Column::SignifierId",
        to = "super::onto::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Signifier,

    #[sea_orm(
        belongs_to = "super::onto::Entity",
        from = "Column::SignifiedId",
        to = "super::onto::Column::Id",
        on_update = "Cascade",
        on_delete = "Cascade"
    )]
    Signified,
}

impl Related<super::onto::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Signifier.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
