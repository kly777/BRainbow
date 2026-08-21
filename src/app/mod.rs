//! 组装层（composition root）：应用状态装配、HTTP 横切装配。
//!
//! 业务域在 `crate::modules`；数据库 schema/迁移在 `crate::db`；
//! 纯类型/无副作用工具在 `crate::shared`。

pub mod context;
pub mod http;
