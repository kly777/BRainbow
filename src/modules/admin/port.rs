//! 管理员设置端口：HTTP handler 通过该 trait 以静态分发调用 `AdminService` 能力。

use async_trait::async_trait;

/// 设置读端口：**别的业务模块**通过它读 `app_settings` 的键，不直接用 `AdminService`
/// （业务域之间禁止互相使用对方实现，`AGENTS.md` 的依赖方向）。
///
/// 只读：管理页的写仍然走 `AdminServicePort`。这里是给"运行时要读某个设置"的场景开的
/// 口子 —— 当前只有时段建议算法的工作时段。
#[async_trait]
pub trait SettingsReader: Send + Sync {
    /// 读一个设置；`None` = 没设过，调用方该退回它自己的默认值
    async fn setting(&self, key: &str) -> Option<String>;
}

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
