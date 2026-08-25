//! 版本化迁移：v1 = create_tables 基线；每个后续版本一个迁移函数。
//!
//! 迁移必须幂等：列/表已存在则跳过；ALTER 失败必须上抛。

mod v10;
mod v11;
mod v12;
mod v2;
mod v3;
mod v4;
mod v5;
mod v6;
mod v7;
mod v8;
mod v9;

use sqlx::SqlitePool;

use super::helpers::set_user_version;
use super::schema::create_tables;

/// 程序支持的最新 schema 版本
pub const LATEST_USER_VERSION: i64 = 12;

/// 迁移统一入口。
///
/// - 新库（user_version = 0）：先建基线 schema，再逐版本走到最新；
/// - 旧库：按当前 user_version 从下一版本开始升级；
/// - user_version 高于程序支持版本：启动失败（防止旧程序破坏新库）。
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    let current: i64 = sqlx::query_scalar("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    if current > LATEST_USER_VERSION {
        return Err(sqlx::Error::Configuration(Box::new(std::io::Error::other(
            format!("数据库 schema 版本 {current} 高于程序支持的 {LATEST_USER_VERSION}"),
        ))));
    }

    if current == 0 {
        create_tables(pool).await?;
    }

    for target in (current.max(1) + 1)..=LATEST_USER_VERSION {
        apply_migration(pool, target).await?;
    }
    Ok(())
}

/// 在单事务中执行一个版本迁移并推进 user_version
async fn apply_migration(pool: &SqlitePool, target: i64) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    match target {
        2 => v2::migrate(&mut tx).await?,
        3 => v3::migrate(&mut tx).await?,
        4 => v4::migrate(&mut tx).await?,
        5 => v5::migrate(&mut tx).await?,
        6 => v6::migrate(&mut tx).await?,
        7 => v7::migrate(&mut tx).await?,
        8 => v8::migrate(&mut tx).await?,
        9 => v9::migrate(&mut tx).await?,
        10 => v10::migrate(&mut tx).await?,
        11 => v11::migrate(&mut tx).await?,
        12 => v12::migrate(&mut tx).await?,
        _ => {
            return Err(sqlx::Error::Configuration(Box::new(std::io::Error::other(
                format!("未知的迁移版本: {target}"),
            ))));
        }
    }
    set_user_version(&mut tx, target).await?;
    tx.commit().await
}
