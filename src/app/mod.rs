//! 组装层（composition root）：配置、数据库初始化、应用状态装配、HTTP 横切装配。
//!
//! 业务域在 `crate::modules`；纯类型/无副作用工具在 `crate::shared`。

pub mod db;
pub mod http;
