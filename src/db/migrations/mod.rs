//! 版本化迁移：v1 = create_tables 基线；每个后续版本一个迁移函数。
//!
//! 迁移必须幂等：列/表已存在则跳过；ALTER 失败必须上抛。

mod v10;
mod v11;
mod v12;
mod v13;
mod v14;
mod v15;
mod v16;
mod v17;
mod v18;
mod v19;
mod v20;
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
pub const LATEST_USER_VERSION: i64 = 20;

/// 迁移链用 `ALTER TABLE … ADD COLUMN` 加过的列：(表, 列)。
///
/// **维护约定（「新增列/表」的收尾一步）：新增迁移加列时，把列登记到这里。**
///
/// 唯一消费者是 `db::tests::upgrade_path_reproduces_migrated_column_definitions`：
/// 它先把这些列从基线库里删掉，逼迁移链**真的去执行**那些 ALTER，再与新建库逐列比对
/// 类型 / NOT NULL / 默认值 / 生成列。为什么必须绕这一圈 ——
/// `fresh_db_baseline_equals_the_full_migration_chain` 的两侧都要先跑 `create_tables`，
/// 那时列已存在，ALTER 全被跳过；新库路径更是整条链都不跑。也就是说**迁移里的列定义
/// 从来没被执行过一次**，它与基线漂移没有守卫（实测：把 v13 的 `DEFAULT 0` 改成
/// `DEFAULT 7`，那条等价性测试照样绿）。漏登记 = 这条测试覆盖不到这一列。
#[cfg(test)]
pub(crate) const ADDED_COLUMNS: &[(&str, &str)] = &[
    ("chat_tree", "kind"),                    // v3
    ("chat_node", "reasoning"),               // v4
    ("signifier_signified", "weight"),        // v5
    ("signifier_signified", "relation_type"), // v5
    ("reading_article", "notes"),             // v6
    ("revlog", "duration_secs"),              // v7
    ("chunk", "user_id"),                     // v11
    ("mem", "user_id"),                       // v11
    ("onto", "user_id"),                      // v11
    ("signifier_signified", "user_id"),       // v11
    ("text_note", "user_id"),                 // v11
    ("bookmark", "user_id"),                  // v11
    ("bookmark_tag", "user_id"),              // v11
    ("reading_article", "user_id"),           // v11
    ("reading_user_word", "user_id"),         // v11
    ("conv_titles", "user_id"),               // v11
    ("articles", "user_id"),                  // v11
    ("bookmark", "visit_count"),              // v13
    ("file", "content_hash"),                 // v16
    ("file", "is_private"),                   // v18
    ("file", "category"),                     // v19
];

/// [`ADDED_COLUMNS`] 里**无法靠删列验证**的列：被 AFTER 触发器引用，SQLite 拒绝
/// `DROP COLUMN`（实测报 `no such column: NEW.created_at`）。
///
/// 这类列的默认值漂移无害：时间归一化触发器在写入时就把值改写成规范格式，
/// 与基线默认值是否字面相同无关（覆盖完整性由 `time_columns_cover_all_timestamp_columns`
/// 钉住）。等价性测试会断言这里的每一列**确实**在 `schema::TIME_COLUMNS` 里 ——
/// 免得"删不掉"被当成万能借口。
#[cfg(test)]
pub(crate) const ADDED_COLUMNS_UNDROPPABLE: &[(&str, &str)] =
    &[("signifier_signified", "created_at")]; // v5

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
        // `user_version = 0` 但**已有表** = 历史库（或手工造的旧 schema）：那些表是
        // `CREATE TABLE IF NOT EXISTS` 补不齐的（老表缺后来的列），必须走迁移链。
        // 所以这个计数要在 create_tables **之前**做。
        let existing_tables: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'")
                .fetch_one(pool)
                .await?;

        create_tables(pool).await?;

        // 只有**真正的新库**（一张表都没有）才跳过迁移链：基线 DDL 就是最新 schema
        // （"新增列/表四步"第 ①④ 步要求每次变更都补进基线），空库上再跑一遍迁移链
        // 全是 no-op —— 而它们逐条 PRAGMA 检查 + 建 FTS/触发器的开销不小
        // （实测：跳过后后端测试执行 51s → 17s）。
        if existing_tables == 0 {
            // 这条"基线 ≡ 基线 + 完整链"的等价性由 `db::tests::
            // fresh_db_baseline_equals_the_full_migration_chain` 钉住：只加迁移、
            // 忘了补基线，那条测试会红。
            sqlx::query(sqlx::AssertSqlSafe(format!(
                "PRAGMA user_version = {LATEST_USER_VERSION}"
            )))
            .execute(pool)
            .await?;
            return Ok(());
        }
    }

    for target in (current.max(1) + 1)..=LATEST_USER_VERSION {
        apply_migration(pool, target).await?;
    }
    Ok(())
}

/// 测试用：跑**完整迁移链**（新库路径的老行为），给"基线等价性"测试做对照。
///
/// 常规入口是 [`migrate`] —— 它在全新库上只建基线就直接置版本号，所以对照那侧
/// 需要这个函数显式地把 v2…v20 都跑一遍。
#[cfg(test)]
pub(crate) async fn apply_full_chain_for_test(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    for target in 2..=LATEST_USER_VERSION {
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
        13 => v13::migrate(&mut tx).await?,
        14 => v14::migrate(&mut tx).await?,
        15 => v15::migrate(&mut tx).await?,
        16 => v16::migrate(&mut tx).await?,
        17 => v17::migrate(&mut tx).await?,
        18 => v18::migrate(&mut tx).await?,
        19 => v19::migrate(&mut tx).await?,
        20 => v20::migrate(&mut tx).await?,
        _ => {
            return Err(sqlx::Error::Configuration(Box::new(std::io::Error::other(
                format!("未知的迁移版本: {target}"),
            ))));
        }
    }
    set_user_version(&mut tx, target).await?;
    tx.commit().await
}
