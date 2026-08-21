use std::sync::Arc;

use super::model::User;
use super::port::UserRepositoryPort;
use super::repository::UserRepository;
use crate::shared::error_types::ServiceError;

/// 查询侧服务——纯读取，无副作用。
///
/// CQRS 分离：注册/登录/改密（认证命令）保留在 `UserService` 中。
#[derive(Clone)]
pub struct UserQueryService {
    repo: Arc<dyn UserRepositoryPort>,
}

impl UserQueryService {
    pub fn new(db: Arc<sqlx::SqlitePool>) -> Self {
        let repo: Arc<dyn UserRepositoryPort> = Arc::new(UserRepository::new(db));
        Self { repo }
    }

    #[allow(dead_code)] // 仅测试/管理场景使用
    pub async fn list_all(&self) -> Result<Vec<User>, ServiceError> {
        self.repo.find_all().await.map_err(ServiceError::Db)
    }

    pub async fn find_by_id(&self, id: i32) -> Result<Option<User>, ServiceError> {
        self.repo.find_by_id(id).await.map_err(ServiceError::Db)
    }
}
