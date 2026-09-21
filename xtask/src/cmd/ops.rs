//! 运维子命令：Caddy 同步、回滚、数据库操作、备份清理、前端单独部署。
//!
//! 这些大多是薄封装，逻辑分别在 `caddy.rs` / `rollback.rs` / `db.rs` / `deploy.rs`。

use std::path::PathBuf;

use crate::caddy;
use crate::config::Config;
use crate::db::{Db, utc_stamp};
use crate::deploy;
use crate::error::{Error, Result};
use crate::local;
use crate::remote::{Remote, glob_in, sh_quote};
use crate::render;
use crate::rollback;
use crate::ui;

// ── Caddy ────────────────────────────────────────────────────────────

/// `caddy`：只同步 Caddy 配置并重载，不碰服务。
pub fn run_caddy(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!(
        "同步 Caddy 配置 {} → {}",
        cfg.app_name, cfg.remote_host
    ));
    let content = render::caddyfile(cfg)?;
    caddy::sync(cfg, remote, &content)?;
    caddy::reload(remote)?;
    ui::done("Caddy 已重载（服务未动）");
    Ok(())
}

// ── 回滚 ────────────────────────────────────────────────────────────

/// `rollback [时间戳] [--yes]`。
pub fn run_rollback(
    cfg: &Config,
    remote: &Remote,
    wanted: Option<String>,
    assume_yes: bool,
) -> Result<()> {
    ui::banner(&format!("回滚 {} → {}", cfg.app_name, cfg.remote_host));

    let db_names = list(remote, &cfg.backup_dir, "db_*.db")?;
    let code_names = list(remote, &cfg.backup_dir, "code_*.tar.gz")?;
    if remote.is_dry_run() && db_names.is_empty() && code_names.is_empty() {
        // dry-run 读不到远端列表（命令没跑），不该因此报"没有可用备份"
        ui::info("（dry-run：读不到备份列表，跳过配对）");
        ui::done("回滚流程演示结束（未执行任何改动）");
        return Ok(());
    }
    let pair = rollback::pick(&db_names, &code_names, wanted.as_deref())?;
    ui::info(&format!("将恢复：{}", pair.describe()));

    if pair.db.is_some() && !assume_yes && !remote.is_dry_run() {
        // 覆盖现网数据库不可逆，所以要一次确认；非交互环境请显式加 --yes
        if !ui::confirm("这会用备份覆盖现网数据库，继续？") {
            return Err(Error::msg("已取消（非交互环境请加 --yes）"));
        }
    }

    rollback::apply(cfg, remote, &pair)?;
    deploy::wait_for_ready(cfg, remote)?;
    ui::done("回滚完成");
    Ok(())
}

// ── 数据库 ──────────────────────────────────────────────────────────

pub fn run_db_check(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("数据库完整性检查: {}", cfg.database_path()));
    Db::new(remote, cfg)?.integrity_check()
}

pub fn run_db_optimize(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("SQLite 统计信息优化: {}", cfg.database_path()));
    Db::new(remote, cfg)?.optimize()?;
    ui::done("已完成 PRAGMA optimize");
    Ok(())
}

/// `db-backup`：手动做一次数据库备份 + 清理。
///
/// 不停服：`sqlite3 .backup` 本身对在线库是安全的。
pub fn run_db_backup(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("手动备份数据库: {}", cfg.database_path()));
    let db = Db::new(remote, cfg)?;
    if !remote.is_dry_run() && !db.exists() {
        return Err(Error::msg(format!(
            "远端没有数据库文件：{}",
            cfg.database_path()
        )));
    }
    db.backup("manual")?;
    db.prune()?;
    ui::done("数据库备份完成");
    Ok(())
}

pub fn run_backup_prune(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("清理过期备份 ({})", cfg.backup_dir));
    Db::new(remote, cfg)?.prune()?;
    ui::done("备份清理完成");
    Ok(())
}

/// `db-pull`：把远端数据库拉到本地 `db/`。
///
/// 与老脚本（直接 scp 主库文件）不同：先在远端做一份**一致性**快照
/// （服务在跑、有未 checkpoint 的 WAL 时，直接拷主文件可能拿到不一致的副本），
/// 再流式拉下来，最后删掉远端临时文件。
pub fn run_db_pull(cfg: &Config, remote: &Remote) -> Result<()> {
    let local_dir = cfg.project_dir.join("db");
    let stem = cfg
        .database_file
        .strip_suffix(".db")
        .unwrap_or(&cfg.database_file);
    let dest = local_dir.join(format!("{stem}_{}.db", utc_stamp()));
    ui::banner(&format!("拉取远端数据库 → {}", dest.display()));

    if !remote.is_dry_run() {
        std::fs::create_dir_all(&local_dir)
            .map_err(|e| Error::io(format!("创建 {}", local_dir.display()), e))?;
    }

    let snapshot = format!("{}/pull_{}.db", cfg.remote_tmp_dir(), utc_stamp());
    remote.ok(&format!("mkdir -p {}", sh_quote(&cfg.remote_tmp_dir())))?;
    let db = Db::new(remote, cfg)?;
    if !remote.is_dry_run() && !db.exists() {
        return Err(Error::msg(format!(
            "远端没有数据库文件：{}",
            cfg.database_path()
        )));
    }
    ui::info("远端做一致性快照…");
    db.snapshot(&snapshot)?;

    ui::info("下载…");
    remote.download(&format!("cat {}", sh_quote(&snapshot)), &dest, "数据库快照")?;
    let _ = remote.ok(&format!("rm -f {}", sh_quote(&snapshot)));

    if !remote.is_dry_run() {
        let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
        ui::done(&format!(
            "已保存 {}（{}）",
            dest.display(),
            local::human_size(size)
        ));
    }
    Ok(())
}

/// `db-push`：用本地数据库覆盖远端（停服 → 备份 → 上传 → 起服）。
///
/// 这是少数几个不可逆的操作，所以默认要一次确认；非交互请加 `--yes`。
/// 推送前会检查本地文件是不是一个像样的 SQLite 库。
pub fn run_db_push(
    cfg: &Config,
    remote: &Remote,
    source: Option<PathBuf>,
    assume_yes: bool,
) -> Result<()> {
    let source = source.unwrap_or_else(|| cfg.project_dir.join(&cfg.database_file));
    ui::banner(&format!(
        "推送本地数据库 → {}:{}",
        cfg.remote_host,
        cfg.database_path()
    ));

    if !source.is_file() {
        return Err(Error::msg(format!(
            "本地数据库不存在：{}",
            source.display()
        )));
    }
    verify_sqlite_file(&source)?;
    let size = std::fs::metadata(&source).map(|m| m.len()).unwrap_or(0);
    ui::info(&format!(
        "源：{}（{}）",
        source.display(),
        local::human_size(size)
    ));

    if !assume_yes && !remote.is_dry_run() && !ui::confirm("这会覆盖远端数据库（不可逆），继续？")
    {
        return Err(Error::msg("已取消（非交互环境请加 --yes）"));
    }

    let db = Db::new(remote, cfg)?;
    rollback::stop_service(cfg, remote)?;
    // 推之前先留一份：万一推上去的库有问题，还有得退
    if db.exists() {
        db.backup("prepush")?;
    }

    // 旧 WAL 必须清掉：它属于被覆盖的那份库，留在原地会被当成新库的事务重放
    let live = cfg.database_path();
    remote.ok(&format!(
        "rm -f {wal} {shm}",
        wal = sh_quote(&format!("{live}-wal")),
        shm = sh_quote(&format!("{live}-shm"))
    ))?;
    ui::info("上传…");
    remote.send_file(&format!("cat > {}", sh_quote(&live)), &source, "数据库")?;

    rollback::start_service(cfg, remote)?;
    deploy::wait_for_ready(cfg, remote)?;
    ui::done("推送完成，服务已重启");
    Ok(())
}

/// 检查文件看着像不像一个 SQLite 库（魔数 + 头长度）。
///
/// 只读文件头 100 字节 —— 178MB 的库也不必整个读进来。
fn verify_sqlite_file(path: &std::path::Path) -> Result<()> {
    use std::io::Read;

    let mut file =
        std::fs::File::open(path).map_err(|e| Error::io(format!("打开 {}", path.display()), e))?;
    let mut header = [0u8; 16];
    let read = file
        .read(&mut header)
        .map_err(|e| Error::io(format!("读取 {}", path.display()), e))?;
    if read < 16 || &header != b"SQLite format 3\0" {
        return Err(Error::msg(format!(
            "{} 不是 SQLite 数据库文件（文件头不对），拒绝推送",
            path.display()
        )));
    }
    Ok(())
}

/// `list` 的复用版：只列名字（不含目录）。
fn list(remote: &Remote, dir: &str, pattern: &str) -> Result<Vec<String>> {
    let out = remote.capture_if_run(&format!("ls -1 {} 2>/dev/null", glob_in(dir, pattern)))?;
    Ok(out
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_sqlite_files() {
        let root = std::env::temp_dir().join(format!("xtask-verify-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("建目录");

        let text = root.join("not-a-db");
        std::fs::write(&text, "这只是个文本文件，不是数据库").expect("写");
        let err = verify_sqlite_file(&text).expect_err("应当拒绝");
        assert!(err.to_string().contains("不是 SQLite"), "{err}");

        let tiny = root.join("tiny");
        std::fs::write(&tiny, b"SQLite").expect("写");
        assert!(verify_sqlite_file(&tiny).is_err(), "太短也应当拒绝");

        let good = root.join("good");
        std::fs::write(&good, b"SQLite format 3\0rest of the header").expect("写");
        verify_sqlite_file(&good).expect("合法文件头应当通过");

        let _ = std::fs::remove_dir_all(&root);
    }
}
