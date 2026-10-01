//! 认证服务：封装 JWT/API key 验证与 CRUD。

use std::sync::Arc;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::modules::admin::port::AdminServicePort;
use crate::modules::admin::service::AdminService;
use crate::shared::actor::Actor;
use crate::shared::claims::Claims;
use crate::shared::jwt::hash_api_key;
use crate::shared::time_text::ISO_UTC_FORMAT;

use super::repository::ApiKeyRepo;

/// API key 响应信息
#[derive(Debug, serde::Serialize)]
pub struct ApiKeyInfo {
    pub id: i32,
    pub role: String,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
}

/// 删除 API key 的结果
pub enum DeleteApiKeyResult {
    Deleted,
    NotFound,
    Forbidden,
}

/// 认证服务（具体类型，不引入 dyn）。
#[derive(Clone)]
pub struct AuthService {
    admin: AdminService,
    repo: ApiKeyRepo,
}

impl AuthService {
    pub fn new(admin: AdminService, db: Arc<SqlitePool>) -> Self {
        Self {
            admin,
            repo: ApiKeyRepo::new(db),
        }
    }

    /// 当前生效的 JWT 密钥（DB 持久化优先于 env）
    pub fn jwt_secret_active(&self) -> String {
        self.admin.jwt_secret_active()
    }

    /// 通过 API key 认证：把 key 行翻译成 [`Actor`]（认证边界的一部分）。
    ///
    /// **无主 key（`user_id IS NULL`）直接拒绝**：v20 之后 `user_id IS NULL` 的行都归了 admin，
    /// 这样一个"没有归属"的身份看不到任何数据，留着只会让人困惑（历史上它映射成 `sub = -1`）。
    /// 重新建一把即可 —— 开发库里这种行是 0 条。
    pub async fn authenticate_api_key(&self, key: &str) -> Result<Option<Actor>, sqlx::Error> {
        let key_hash = hash_api_key(key);
        match self.repo.find_by_hash(&key_hash).await? {
            Some((role, Some(user_id))) => Ok(Some(Actor::from(&Claims {
                sub: user_id,
                role,
                exp: usize::MAX,
            }))),
            Some((_, None)) => {
                tracing::warn!("API key 没有归属（user_id 为空），已拒绝；请重新创建");
                Ok(None)
            }
            None => Ok(None),
        }
    }

    /// 创建 API key（返回 (id, 明文 key)）。角色由调用者的身份决定（admin 才能建 admin key）。
    pub async fn create_api_key(&self, actor: &Actor) -> Result<ApiKeyInfo, sqlx::Error> {
        let role = if actor.is_admin() { "admin" } else { "user" };
        let key = Uuid::new_v4().to_string().replace('-', "");
        let key_hash = hash_api_key(&key);
        let id = self
            .repo
            .insert(&key_hash, role, Some(actor.user_id()))
            .await?;
        Ok(ApiKeyInfo {
            id: id as i32,
            role: role.to_string(),
            created_at: chrono::Utc::now().format(ISO_UTC_FORMAT).to_string(),
            key: Some(key),
        })
    }

    /// 列出当前用户可见的 API key（admin 全部、普通用户自己的 —— 同一套归属判据）
    pub async fn list_api_keys(&self, actor: &Actor) -> Result<Vec<ApiKeyInfo>, sqlx::Error> {
        let rows = self.repo.list_all().await?;
        let items: Vec<ApiKeyInfo> = rows
            .into_iter()
            .filter(|row| actor.can_read(row.user_id.map(i64::from)))
            .map(|row| ApiKeyInfo {
                id: row.id,
                role: row.role,
                created_at: row.created_at,
                key: None,
            })
            .collect();
        Ok(items)
    }

    /// 删除 API key（非 admin 只能删自己的 —— 走同一处归属判据）
    pub async fn delete_api_key(
        &self,
        actor: &Actor,
        id: i32,
    ) -> Result<DeleteApiKeyResult, sqlx::Error> {
        if !actor.is_admin() {
            let owner = self.repo.find_owner(id).await?;
            match owner {
                Some(owner) if actor.can_write(owner.map(i64::from)) => {}
                Some(_) => return Ok(DeleteApiKeyResult::Forbidden),
                None => return Ok(DeleteApiKeyResult::NotFound),
            }
        }

        match self.repo.delete(id).await? {
            0 => Ok(DeleteApiKeyResult::NotFound),
            _ => Ok(DeleteApiKeyResult::Deleted),
        }
    }
}
