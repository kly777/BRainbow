use async_trait::async_trait;

use super::model::User;

/// Repository port: the seam between user use-cases and persistence.
///
/// `UserService` / `UserQueryService` depend only on this interface.
#[async_trait]
pub trait UserRepositoryPort: Send + Sync {
    #[allow(dead_code)] // 仅测试/管理场景使用
    async fn find_all(&self) -> Result<Vec<User>, sqlx::Error>;

    #[allow(dead_code)]
    async fn find_by_id(&self, id: i32) -> Result<Option<User>, sqlx::Error>;

    async fn find_by_name(&self, name: &str) -> Result<Option<User>, sqlx::Error>;

    async fn create(
        &self,
        name: &str,
        password_hash: &str,
        role: &str,
    ) -> Result<User, sqlx::Error>;

    async fn count(&self) -> Result<i64, sqlx::Error>;

    async fn update_password(&self, id: i32, new_hash: &str) -> Result<(), sqlx::Error>;
}
