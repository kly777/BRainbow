use async_graphql::{Context, EmptySubscription, Object, Schema, SimpleObject};
use async_graphql_axum::{GraphQLRequest, GraphQLResponse};
use axum::{Router, extract::State, response::Html, routing::get};
use std::sync::Arc;

use crate::{
    modules::{
        card::{Card, CardService},
        onto::{Onto, OntoService},
        sign::{SignService, SignifierSignified},
        task::{Task, TaskService},
        user::User,
    },
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
}

impl From<SignifierSignified> for GraphQLSign {
    fn from(sign: SignifierSignified) -> Self {
        Self {
            id: sign.id,
            signifier: sign.signifier,
            signified: sign.signified,
        }
    }
}

#[derive(Debug, Clone, SimpleObject)]
pub struct GraphQLTask {
    pub id: i32,
    pub title: String,
    pub description: Option<String>,
    pub parent_task_id: Option<i32>,
    pub status: String,
    pub completed_at: Option<String>,
    pub effort_estimate_minutes: Option<i32>,
    pub user_id: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<Task> for GraphQLTask {
    fn from(task: Task) -> Self {
        Self {
            id: task.id,
            title: task.title,
            description: task.description,
            parent_task_id: task.parent_task_id,
            status: task.status.to_string(),
            completed_at: task.completed_at.map(|dt| dt.to_string()),
            effort_estimate_minutes: task.effort_estimate_minutes,
            user_id: task.user_id,
            created_at: task.created_at.to_string(),
            updated_at: task.updated_at.to_string(),
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
        let repo = crate::modules::user::UserRepository::new(state.db.clone());

        let users = repo.find_all().await
            .map_err(|e| async_graphql::Error::new(format!("获取用户失败: {}", e)))?;

        Ok(users.into_iter().map(GraphQLUser::from).collect())
    }

    /// 获取所有卡片
    async fn cards(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLCard>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = CardService::new(state.db.clone());

        let cards = service.get_all_cards().await
            .map_err(|e| async_graphql::Error::new(format!("获取卡片失败: {}", e)))?;

        Ok(cards.into_iter().map(GraphQLCard::from).collect())
    }

    /// 获取所有本体
    async fn ontos(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLOnto>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = OntoService::new(state.db.clone());

        let ontos = service.get_all_ontos().await
            .map_err(|e| async_graphql::Error::new(format!("获取本体失败: {}", e)))?;

        Ok(ontos.into_iter().map(GraphQLOnto::from).collect())
    }

    /// 获取所有符号关系
    async fn signs(&self, ctx: &Context<'_>) -> async_graphql::Result<Vec<GraphQLSign>> {
        let state = ctx.data::<Arc<AppState>>()?;
        let service = SignService::new(state.db.clone());

        let signs = service.get_all_signs().await
            .map_err(|e| async_graphql::Error::new(format!("获取符号关系失败: {}", e)))?;

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
}

// ========== 变更类型 ==========

pub struct Mutation;

#[Object]
impl Mutation {
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

        let request = crate::modules::task::CreateTaskRequest {
            title,
            description,
            parent_task_id: None,
            effort_estimate_minutes: None,
            user_id,
        };
        let task = service.create_task(request).await
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

        // Convert status string to TaskStatus enum
        let task_status = match status {
            Some(s) => match s.to_lowercase().as_str() {
                "backlog" => Some(crate::modules::task::TaskStatus::Backlog),
                "active" => Some(crate::modules::task::TaskStatus::Active),
                "completed" => Some(crate::modules::task::TaskStatus::Completed),
                "archived" => Some(crate::modules::task::TaskStatus::Archived),
                _ => None,
            },
            None => None,
        };

        let request = crate::modules::task::UpdateTaskRequest {
            title,
            description: description.map(Some), // Convert Option<String> to Option<Option<String>>
            parent_task_id: None,
            status: task_status,
            effort_estimate_minutes: priority.map(Some), // Map priority to effort_estimate_minutes
            user_id: user_id.map(Some),
        };

        let task = service.update_task(id, request).await
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

// ========== GraphQL 路由 ==========

/// GraphQL playground 页面
pub async fn graphql_playground() -> Html<String> {
    Html(async_graphql::http::playground_source(
        async_graphql::http::GraphQLPlaygroundConfig::new("/api/graphql"),
    ))
}

/// GraphQL 处理器
pub async fn graphql_handler(
    State(state): State<AppState>,
    req: GraphQLRequest,
) -> GraphQLResponse {
    let schema = Schema::build(Query, Mutation, EmptySubscription)
        .data(Arc::new(state))
        .finish();

    schema.execute(req.into_inner()).await.into()
}

/// 创建 GraphQL 路由
pub fn create_router() -> Router<AppState> {
    Router::new()
        .route("/api/graphql", get(graphql_playground).post(graphql_handler))
}