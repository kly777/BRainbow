//! 数据库基础设施的 facade。
//!
//! 真正的实现已经移到 workspace crate `brainbow-db`（`crates/db/`）：连接、
//! schema 声明、迁移和自检都不依赖业务模块，独立成 crate 后可以单独测试。
//! 这里保留 `crate::db::*` 的旧路径，避免所有调用点跟着改。

pub use brainbow_db::{connect, migrate, verify};
