//! 管理员设置端口：HTTP handler 通过该 trait 以静态分发调用 `AdminService` 能力。

use async_trait::async_trait;

#[async_trait]
pub trait AdminServicePort: Send + Sync {
    /// 当前是否开放注册（DB 优先于 env 初始值）
    async fn allow_register_active(&self) -> bool;

    /// 更新开放注册（写 DB + 更新缓存）
    async fn set_allow_register(&self, v: bool) -> Result<(), sqlx::Error>;

    /// 当前生效的 JWT 密钥（DB 持久化优先于 env）
    fn jwt_secret_active(&self) -> String;

    /// JWT 密钥状态（已持久化 / 长度）
    async fn settings_jwt_status(&self) -> (bool, usize);

    /// 轮换 JWT 密钥：写 DB + 更新缓存（立即生效，旧 token 全部失效）
    async fn rotate_jwt_secret(&self, new_secret: &str) -> Result<(), sqlx::Error>;
}
