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

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    const TEST_SECRET: &str = "test-jwt-secret";

    async fn setup() -> UserService {
        let pool = Arc::new(SqlitePool::connect("sqlite::memory:").await.unwrap());
        sqlx::query("CREATE TABLE user (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user')")
            .execute(&*pool).await.unwrap();
        UserService::new(pool)
    }

    #[tokio::test]
    async fn register_first_user_is_admin() {
        let svc = setup().await;
        let (user, token) = svc.register("admin".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        assert_eq!(user.role, "admin");
        assert!(!token.is_empty());
    }

    #[tokio::test]
    async fn register_second_user_is_user() {
        let svc = setup().await;
        svc.register("admin".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        let (user, _) = svc.register("user1".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        assert_eq!(user.role, "user");
    }

    #[tokio::test]
    async fn register_empty_name_rejected() {
        let svc = setup().await;
        let err = svc.register("  ".into(), "pass1234".into(), TEST_SECRET).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn register_short_password_rejected() {
        let svc = setup().await;
        let err = svc.register("user".into(), "abc".into(), TEST_SECRET).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn register_duplicate_name() {
        let svc = setup().await;
        svc.register("alice".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        let err = svc.register("alice".into(), "other123".into(), TEST_SECRET).await.unwrap_err();
        assert!(matches!(err, ServiceError::AlreadyExists(_)));
    }

    #[tokio::test]
    async fn login_success() {
        let svc = setup().await;
        svc.register("bob".into(), "secret123".into(), TEST_SECRET).await.unwrap();
        let (user, token) = svc.login("bob", "secret123", TEST_SECRET).await.unwrap();
        assert_eq!(user.name, "bob");
        assert!(!token.is_empty());
    }

    #[tokio::test]
    async fn login_wrong_password() {
        let svc = setup().await;
        svc.register("bob".into(), "correct".into(), TEST_SECRET).await.unwrap();
        let err = svc.login("bob", "wrong", TEST_SECRET).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn login_nonexistent_user() {
        let svc = setup().await;
        let err = svc.login("nobody", "pass", TEST_SECRET).await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn list_all_users() {
        let svc = setup().await;
        svc.register("a".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        svc.register("b".into(), "pass1234".into(), TEST_SECRET).await.unwrap();
        let users = svc.list_all().await.unwrap();
        assert_eq!(users.len(), 2);
    }

    #[tokio::test]
    async fn change_password_success() {
        let svc = setup().await;
        let (user, _) = svc.register("alice".into(), "oldPass1".into(), TEST_SECRET).await.unwrap();
        svc.change_password(user.id, "oldPass1", "newPass2").await.unwrap();
        // 用新密码登录验证
        let (_, token) = svc.login("alice", "newPass2", TEST_SECRET).await.unwrap();
        assert!(!token.is_empty());
    }

    #[tokio::test]
    async fn change_password_wrong_old() {
        let svc = setup().await;
        let (user, _) = svc.register("alice".into(), "realPass".into(), TEST_SECRET).await.unwrap();
        let err = svc.change_password(user.id, "wrong", "newPass").await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn change_password_short_new() {
        let svc = setup().await;
        let (user, _) = svc.register("alice".into(), "realPass".into(), TEST_SECRET).await.unwrap();
        let err = svc.change_password(user.id, "realPass", "ab").await.unwrap_err();
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }
}
