//! HTTP 层横切：认证/鉴权、错误响应、分页、批量、限速、路由
//!
//! 业务模块（modules/）通过 `crate::app::http::xxx` 引用这些基础设施。

pub mod auth;
pub mod rate_limit;
pub mod routes;
