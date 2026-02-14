use sea_orm::entity::prelude::*;

#[sea_orm::model]
#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "onto")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: i32,

    pub name: String,

    /// 作为能指
    #[sea_orm(
        self_ref,
        via = "signifier_signified",
        from = "Signifier",
        to = "Signified"
    )]
    pub signifiers: HasMany<Entity>,

    /// 作为所指
    #[sea_orm(self_ref, via = "signifier_signified", reverse)]
    pub signifieds: HasMany<Entity>,
}

impl ActiveModelBehavior for ActiveModel {}
