use async_graphql::{Context, EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{Router, extract::State, response::Html, routing::get};
use std::sync::Arc;

use crate::{
    entity::{Card, Onto, SignifierSignified, Task, User},
    services::{card::CardService, onto::OntoService, sign::SignService, task::TaskService},
    state::AppState,
};

// ========== GraphQL 类型定义 ==========

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLUser {
    pub id: i32,
    pub name: String,
}

impl From<User> for GraphQLUser {
    fn from(user: User) -> Self {
        Self {
            id: user.id,
            name: user.name,
        }
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLCard {
    pub id: i32,
    pub title: String,
    pub content: String,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Card> for GraphQLCard {
    fn from(card: Card) -> Self {
        Self {
            id: card.id,
            title: card.title,
            content: card.content,
            created_at: card.created_at.to_string(),
            updated_at: card.updated_at.to_string(),
        }
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLOnto {
    pub id: i32,
    pub name: String,
    pub description: Option<String>,
}

impl From<Onto> for GraphQLOnto {
    fn from(onto: Onto) -> Self {
        Self {
            id: onto.id,
            name: onto.name,
            description: onto.description,
        }
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLSign {
    pub id: i32,
    pub signifier: String,
    pub signified: String,
    pub onto_id: Option<i32>,
    pub weight: Option<f64>,
    pub relation_type: Option<String>,
    pub created_at: String,
}

impl From<SignifierSignified> for GraphQLSign {
    fn from(sign: SignifierSignified) -> Self {
        Self {
            id: sign.id,
            signifier: sign.signifier,
            signified: sign.signified,
            onto_id: sign.onto_id,
            weight: sign.weight,
            relation_type: sign.relation_type,
            created_at: sign.created_at.to_string(),
        }
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLTask {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<String>,
    pub priority: Option<i32>,
    pub user_id: Option<i32>,
    pub created_at: String,
}

impl From<Task> for GraphQLTask {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            user_id: task.user_id,
            created_at: task.created_at.to_string(),
        }
    }
}

// ========== 查询类型 ==========

pub struct Query;

#[Object]
impl Query {
    /// 获取所有用户
    async fn users(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLUser>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let repo = crate::repos::user::UserRepository::new(state.db.clone());

        let users = repo.find_all().await
            .map_err(|e| async_graphql::Error::new(format!("获取用户失败: {}", e)))?;

        Ok(users.into_iter().map(GraphQLUser::from).collect())
    }

    /// 根据ID获取用户

    async fn user(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Option<GraphQLUser>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let repo = crate::repos::user::UserRepository::new(state.db.clone());

        let user = repo.find_by_id(id).await
            .map_err(|e| async_graphql::Error::new(format!("获取用户失败: {}", e)))?;

        Ok(user.map(GraphQLUser::from))
    }

    /// 获取所有卡片
    async fn cards(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLCard>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let cards = service.get_all_cards().await
            .map_err(|e| async_graphql::Error::new(format!("获取卡片失败: {}", e)))?;

        Ok(cards.into_iter().map(GraphQLCard::from).collect())
    }

    /// 根据ID获取卡片
    async fn card(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Option<GraphQLCard>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let card = service.get_card_by_id(id).await
            .map_err(|e| async_graphql::Error::new(format!("获取卡片失败: {}", e)))?;

        Ok(card.map(GraphQLCard::from))
    }

    /// 获取所有本体
    async fn ontos(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLOnto>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let ontos = service.get_all_ontos().await
            .map_err(|e| async_graphql::Error::new(format!("获取本体失败: {}", e)))?;

        Ok(ontos.into_iter().map(GraphQLOnto::from).collect())
    }

    /// 根据ID获取本体
    async fn onto(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Option<GraphQLOnto>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let onto = service.get_onto_by_id(id).await
            .map_err(|e| async_graphql::Error::new(format!("获取本体失败: {}", e)))?;

        Ok(onto.map(GraphQLOnto::from))
    }

    /// 获取所有符号关系
    async fn signs(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLSign>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let signs = service.get_all_signs().await
            .map_err(|e| async_graphql::Error::new(format!("获取符号关系失败: {}", e)))?;

        Ok(signs.into_iter().map(GraphQLSign::from).collect())
    }

    /// 根据ID获取符号关系
    async fn sign(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Option<GraphQLSign>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let sign = service.get_sign_by_id(id).await
            .map_err(|e| async_graphql::Error::new(format!("获取符号关系失败: {}", e)))?;

        Ok(sign.map(GraphQLSign::from))
    }

    /// 根据能指获取符号关系
    async fn signs_by_signifier(&self, ctx: &Context<'_>, signifier: String) -> async_graphql::Result<Vec<GraphQLSign>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let signs = service.get_signs_by_signifier(&signifier).await
            .map_err(|e| async_graphql::Error::new(format!("根据能指获取符号关系失败: {}", e)))?;

        Ok(signs.into_iter().map(GraphQLSign::from).collect())
    }

    /// 根据所指获取符号关系
    async fn signs_by_signified(&self, ctx: &Context<'_>, signified: String) -> async_graphql::Result<Vec<GraphQLSign>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let signs = service.get_signs_by_signified(&signified).await
            .map_err(|e| async_graphql::Error::new(format!("根据所指获取符号关系失败: {}", e)))?;

        Ok(signs.into_iter().map(GraphQLSign::from).collect())
    }

    /// 获取所有任务
    async fn tasks(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLTask>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = TaskService::new(state.db.clone());

        let tasks = service.get_all_tasks().await
            .map_err(|e| async_graphql::Error::new(format!("获取任务失败: {}", e)))?;

        Ok(tasks.into_iter().map(GraphQLTask::from).collect())
    }

    /// 根据ID获取任务
    async fn task(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<Option<GraphQLTask>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = TaskService::new(state.db.clone());

        let task = service.get_task_by_id(id).await
            .map_err(|e| async_graphql::Error::new(format!("获取任务失败: {}", e)))?;

        Ok(task.map(GraphQLTask::from))
    }

    /// 简单的测试查询
    async fn hello(&self) -> &str {
        "Hello from Brainbow GraphQL API!"
    }

    /// 数学运算测试
    async fn add(&self, a: i32, b: i32) -> i32 {
        a + b
    }
}

// ========== 变更类型 ==========

pub struct Mutation;

#[Object]
impl Mutation {
    /// 创建用户
    async fn create_user(&self, ctx: &Context<'_>, name: String) -> async_graphql::Result<GraphQLUser> {
        let state = ctx.data::<Arc<AppState>>()?;
        let repo = crate::repos::user::UserRepository::new(state.db.clone());

        let user = repo.create(name).await
            .map_err(|e| async_graphql::Error::new(format!("创建用户失败: {}", e)))?;

        Ok(GraphQLUser::from(user))
    }

    /// 创建卡片
    async fn create_card(
        &self,
        ctx: &Context<'_>,
        title: String,
        content: String,
    ) -> async_graphql::Result<GraphQLCard> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let card = service.create_card(title, content).await
            .map_err(|e| async_graphql::Error::new(format!("创建卡片失败: {}", e)))?;

        Ok(GraphQLCard::from(card))
    }

    /// 更新卡片
    async fn update_card(
        &self,
        ctx: &Context<'_>,
        id: i32,
        title: Option<String>,
        content: Option<String>,
    ) -> async_graphql::Result<GraphQLCard> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let card = service.update_card(id, title, content).await
            .map_err(|e| async_graphql::Error::new(format!("更新卡片失败: {}", e)))?;

        Ok(GraphQLCard::from(card))
    }

    /// 删除卡片
    async fn delete_card(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let rows_affected = service.delete_card(id).await
            .map_err(|e| async_graphql::Error::new(format!("删除卡片失败: {}", e)))?;

        Ok(rows_affected > 0)
    }

    /// 创建本体
    async fn create_onto(
        &self,
        ctx: &Context<'_>,
        name: String,
        description: Option<String>,
    ) -> async_graphql::Result<GraphQLOnto> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let onto = service.create_onto(name, description).await
            .map_err(|e| async_graphql::Error::new(format!("创建本体失败: {}", e)))?;

        Ok(GraphQLOnto::from(onto))
    }

    /// 更新本体
    async fn update_onto(
        &self,
        ctx: &Context<'_>,
        id: i32,
        name: Option<String>,
        description: Option<String>,
    ) -> async_graphql::Result<GraphQLOnto> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let onto = service.update_onto(id, name, description).await
            .map_err(|e| async_graphql::Error::new(format!("更新本体失败: {}", e)))?;

        Ok(GraphQLOnto::from(onto))
    }

    /// 删除本体
    async fn delete_onto(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let rows_affected = service.delete_onto(id).await
            .map_err(|e| async_graphql::Error::new(format!("删除本体失败: {}", e)))?;

        Ok(rows_affected > 0)
    }

    /// 创建符号关系
    async fn create_sign(
        &self,
        ctx: &Context<'_>,
        signifier: String,
        signified: String,
        onto_id: Option<i32>,
        weight: Option<f64>,
        relation_type: Option<String>,
    ) -> async_graphql::Result<GraphQLSign> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let sign = service.create_sign(signifier, signified, onto_id, weight, relation_type).await
            .map_err(|e| async_graphql::Error::new(format!("创建符号关系失败: {}", e)))?;

        Ok(GraphQLSign::from(sign))
    }

    /// 删除符号关系
    async fn delete_sign(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let rows_affected = service.delete_sign(id).await
            .map_err(|e| async_graphql::Error::new(format!("删除符号关系失败: {}", e)))?;

        Ok(rows_affected > 0)
    }

    /// 创建任务
    async fn create_task(
        &self,
        ctx: &Context<'_>,
        title: String,
        description: Option<String>,
        user_id: Option<i32>,
    ) -> async_graphql::Result<GraphQLTask> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = TaskService::new(state.db.clone());

        let task = service.create_task(title, description, user_id).await
            .map_err(|e| async_graphql::Error::new(format!("创建任务失败: {}", e)))?;

        Ok(GraphQLTask::from(task))
    }

    /// 更新任务
    async fn update_task(
        &self,
        ctx: &Context<'_>,
        id: i32,
        title: Option<String>,
        description: Option<String>,
        status: Option<String>,
        priority: Option<i32>,
        user_id: Option<i32>,
    ) -> async_graphql::Result<GraphQLTask> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = TaskService::new(state.db.clone());

        let task = service.update_task(id, title, description, status, priority, user_id).await
            .map_err(|e| async_graphql::Error::new(format!("更新任务失败: {}", e)))?;

        Ok(GraphQLTask::from(task))
    }

    /// 删除任务
    async fn delete_task(&self, ctx: &Context<'_>, id: i32) -> async_graphql::Result<bool> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = TaskService::new(state.db.clone());

        let rows_affected = service.delete_task(id).await
            .map_err(|e| async_graphql::Error::new(format!("删除任务失败: {}", e)))?;

        Ok(rows_affected > 0)
    }
}

// ========== Schema 类型 ==========

pub type AppSchema = Schema<Query, Mutation, EmptySubscription>;

// ========== 处理器函数 ==========

async fn graphql_playground() -> Html<String> {
    Html(
        async_graphql::http::GraphiQLSource::build()
            .endpoint("/graphql")
            .finish(),
    )
}

async fn graphql_handler(
    State(state): State<AppState>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let schema = AppSchema::build(Query, Mutation, EmptySubscription).finish();
    let mut query = req.into_inner();
    query = query.data(Arc::new(state));
    schema.execute(query).await.into()
}

pub fn create_router() -> Router<AppState> {
    Router::new()
        .route("/", get(graphql_playground).post(graphql_handler))
}
