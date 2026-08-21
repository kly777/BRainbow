//! 共享层：业务无关、可共用、无副作用的纯类型与纯函数
//!
//! - `error_types`：ErrorBody / ServiceError（不含 axum 响应耦合）
//! - `pagination`：分页参数与响应形状
//! - `batch`：批量请求/响应形状

pub mod batch;
pub mod claims;
pub mod config;
pub mod db_query;
pub mod error_types;
pub mod jwt;
pub mod pagination;
pub mod response;
pub mod search;
pub mod time_text;
