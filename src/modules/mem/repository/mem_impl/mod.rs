//! MemRepo 具体方法实现（SQLite adapter）。
//!
//! `new` 与子模块声明放在这里，方法按领域拆分到各子文件。

use std::sync::Arc;

use super::*;

impl MemRepo {
    pub fn new(pool: Arc<SqlitePool>) -> Self {
        Self { pool }
    }
}

mod chunk;
mod crud;
mod fsrs;
mod helpers;
mod learning;
mod mnemonic;
mod revlog;
mod tag;
