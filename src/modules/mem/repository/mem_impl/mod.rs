//! MemRepo 具体方法实现（SQLite adapter）。
//!
//! `new` 与子模块声明放在这里，方法按领域拆分到各子文件。

use std::sync::Arc;

use super::*;

impl MemRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }

    /// 测试/内部工具访问数据库连接池。
    #[cfg(test)]
    pub(crate) fn pool(&self) -> &Arc<SqlitePool> {
        &self.pool
    }
}

mod chunk;
mod fsrs;
mod helpers;
mod learning;
mod tag;
mod trait_impl;
