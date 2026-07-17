use std::sync::Arc;

use bcrypt::{DEFAULT_COST, hash, verify};

use super::model::User;
use super::repository::UserRepository;
use crate::auth::create_token;
use crate::error::ServiceError;

#[derive(Clone)]
pub struct UserService {
    repo: UserRepository,
}

impl UserService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        Self {
            repo: UserRepository::new(db),
        }
    }

    pub async fn register(
        &self,
        name: String,
        password: String,
        jwt_secret: &str,
    ) -> Result<(User, String), ServiceError> {
        let name = name.trim().to_string();
        let password = password.trim().to_string();

        if name.is_empty() || password.is_empty() {
            return Err(ServiceError::InvalidInput("用户名和密码不能为空".into()));
        }
        if password.len() < 4 {
            return Err(ServiceError::InvalidInput("密码至少4位".into()));
        }

        if let Ok(Some(_)) = self.repo.find_by_name(&name).await {
            return Err(ServiceError::AlreadyExists("用户名已存在".into()));
        }

        let role = match self.repo.count().await {
            Ok(0) => "admin",
            _ => "user",
        };

        let password_hash =
            hash(&password, DEFAULT_COST).map_err(|e| ServiceError::Internal(e.to_string()))?;

        let user = self
            .repo
            .create(&name, &password_hash, role)
            .await
            .map_err(ServiceError::Db)?;

        let token = create_token(user.id, &user.role, jwt_secret);
        Ok((user, token))
    }

    pub async fn login(
        &self,
        name: &str,
        password: &str,
        jwt_secret: &str,
    ) -> Result<(User, String), ServiceError> {
        let user = self
            .repo
            .find_by_name(name.trim())
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::InvalidInput("用户名或密码错误".into()))?;

        match verify(password, &user.password_hash) {
            Ok(true) => {
                let token = create_token(user.id, &user.role, jwt_secret);
                Ok((user, token))
            }
            Ok(false) => Err(ServiceError::InvalidInput("用户名或密码错误".into())),
            Err(e) => Err(ServiceError::Internal(e.to_string())),
        }
    }

    pub async fn list_all(&self) -> Result<Vec<User>, ServiceError> {
        self.repo.find_all().await.map_err(ServiceError::Db)
    }

    pub async fn change_password(
        &self,
        user_id: i32,
        old_password: &str,
        new_password: &str,
    ) -> Result<(), ServiceError> {
        let user = self
            .repo
            .find_by_id(user_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("用户不存在".into()))?;

        match verify(old_password, &user.password_hash) {
            Ok(true) => {}
            Ok(false) => return Err(ServiceError::InvalidInput("当前密码错误".into())),
            Err(e) => return Err(ServiceError::Internal(e.to_string())),
        }

        if new_password.len() < 4 {
            return Err(ServiceError::InvalidInput("新密码至少4位".into()));
        }

        let new_hash =
            hash(new_password, DEFAULT_COST).map_err(|e| ServiceError::Internal(e.to_string()))?;

        self.repo
            .update_password(user_id, &new_hash)
            .await
            .map_err(ServiceError::Db)
    }
}
