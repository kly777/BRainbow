//! 认证服务：封装 JWT/API key 验证与 CRUD。

use std::sync::Arc;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::modules::admin::port::AdminServicePort;
use crate::modules::admin::service::AdminService;
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

    /// 通过 API key 认证
    pub async fn authenticate_api_key(&self, key: &str) -> Result<Option<Claims>, sqlx::Error> {
        let key_hash = hash_api_key(key);
        match self.repo.find_by_hash(&key_hash).await? {
            Some((role, user_id)) => Ok(Some(Claims {
                sub: user_id.unwrap_or(-1),
                role,
                exp: usize::MAX,
            })),
            None => Ok(None),
        }
    }

    /// 创建 API key（返回 (id, 明文 key)）
    pub async fn create_api_key(
        &self,
        role: &str,
        user_id: Option<i32>,
    ) -> Result<ApiKeyInfo, sqlx::Error> {
        let key = Uuid::new_v4().to_string().replace('-', "");
        let key_hash = hash_api_key(&key);
        let id = self.repo.insert(&key_hash, role, user_id).await?;
        Ok(ApiKeyInfo {
            id: id as i32,
            role: role.to_string(),
            created_at: chrono::Utc::now().format(ISO_UTC_FORMAT).to_string(),
            key: Some(key),
        })
    }

    /// 列出当前用户可见的 API key
    pub async fn list_api_keys(&self, claims: &Claims) -> Result<Vec<ApiKeyInfo>, sqlx::Error> {
        let rows = self.repo.list_all().await?;
        let items: Vec<ApiKeyInfo> = rows
            .into_iter()
            .filter(|row| claims.role == "admin" || Some(claims.sub) == row.user_id)
            .map(|row| ApiKeyInfo {
                id: row.id,
                role: row.role,
                created_at: row.created_at,
                key: None,
            })
            .collect();
        Ok(items)
    }

    /// 删除 API key
    pub async fn delete_api_key(
        &self,
        claims: &Claims,
        id: i32,
    ) -> Result<DeleteApiKeyResult, sqlx::Error> {
        // 非 admin 只能删自己的 key
        if claims.role != "admin" {
            let owner = self.repo.find_owner(id).await?;
            match owner {
                Some(Some(uid)) if uid == claims.sub => {}
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
