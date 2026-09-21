//! 回滚：把代码（与数据库）退回某一份备份。
//!
//! 与 deploy.sh 的 `cmd_rollback`（672-807）相比的三处修正：
//!
//! 1. **临时目录建在 `$REMOTE_DIR/tmp` 下**。老写法用
//!    `$REMOTE_BASE/${APP_NAME}_rollback_$$`，也就是 `/opt/brb_rollback_<pid>`，
//!    而 ssh 用户对 `/opt` 没有写权限 —— 于是 `mkdir` 失败、回滚**必然失败**
//!    （AGENTS.md 记的就是这一条，实际只剩"重启现有产物"那层）。
//! 2. **不再 `rm -rf $SERVICE_DIR`**。老写法重建整个服务目录，会连带删掉不在
//!    备份里的东西（`bin/ffmpeg`、`mem_config.json`）。这里只替换 `brainbow`
//!    与 `dist`，其余原样保留 —— 顺带也就不会丢 `bin/ffmpeg` 了。
//! 3. **代码备份与数据库备份按同一个时间戳配对**。老写法从数据库名反推代码名
//!    （`db_deploy_<ts>` → `code_deploy_<ts>`），可实际的代码备份叫
//!    `code_<ts>.tar.gz` —— 对不上，于是"回滚代码"这一步被静默跳过。
//!
//! 备份只含 `brainbow` + `dist/`（这是 `code_*.tar.gz` 的定义，也让它保持在
//! 十几 MB 而不是把 76MB 的 ffmpeg 一起打包）；因为第 2 点，`bin/` 不受影响。

use chrono::NaiveDateTime;

use crate::config::Config;
use crate::db::utc_stamp;
use crate::error::{Error, Result};
use crate::remote::{Remote, path_of, sh_quote};
use crate::stamp;
use crate::ui;

/// 要回滚的一组备份，存的是**去掉扩展名的 stem**
/// （`code_20260921_193500` / `db_deploy_20260921_193500`）。
#[derive(Debug, PartialEq, Eq)]
pub struct Pair {
    pub code: Option<String>,
    pub db: Option<String>,
}

impl Pair {
    /// 给人看的描述：将要恢复什么。
    pub fn describe(&self) -> String {
        match (&self.code, &self.db) {
            (Some(code), Some(db)) => format!("代码 {code} + 数据库 {db}"),
            (Some(code), None) => format!("仅代码 {code}（没找到配对的数据库备份）"),
            (None, Some(db)) => format!("仅数据库 {db}（没找到配对的代码备份）"),
            (None, None) => "（无可恢复项）".to_string(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.code.is_none() && self.db.is_none()
    }
}

/// 从备份文件名里挑出要回滚的一组。
///
/// - 指定 `wanted`（时间戳）时精确配对：`code_<ts>.tar.gz` + `db_<用途>_<ts>.db`；
/// - 不指定时取**最新的一份代码备份**，并配同一时间戳的数据库备份
///   （没有就退回最新的数据库备份）。
///
/// 解析不出时间戳的文件不参与挑选：判断不了新旧，不如不选。
pub fn pick(db_names: &[String], code_names: &[String], wanted: Option<&str>) -> Result<Pair> {
    let dated = |names: &[String]| -> Vec<(String, NaiveDateTime)> {
        let mut items: Vec<(String, NaiveDateTime)> = names
            .iter()
            .filter_map(|name| {
                stamp::parse(name).map(|at| (stamp::strip_backup_ext(name).to_string(), at))
            })
            .collect();
        items.sort_by_key(|(_, at)| std::cmp::Reverse(*at));
        items
    };
    let dbs = dated(db_names);
    let codes = dated(code_names);

    match wanted {
        Some(ts) => {
            let code = codes
                .iter()
                .find(|(stem, _)| stem == &format!("code_{ts}"))
                .map(|(stem, _)| stem.clone());
            let db = dbs
                .iter()
                .find(|(stem, _)| stem.ends_with(&format!("_{ts}")))
                .map(|(stem, _)| stem.clone());
            if code.is_none() && db.is_none() {
                return Err(Error::msg(format!(
                    "找不到时间戳为 {ts} 的备份（先 `just list-backups` 看看）"
                )));
            }
            Ok(Pair { code, db })
        }
        None => {
            let code = codes.first().map(|(stem, _)| stem.clone());
            let db = code
                .as_ref()
                .and_then(|stem| stem.strip_prefix("code_"))
                .and_then(|ts| {
                    dbs.iter()
                        .find(|(stem, _)| stem.ends_with(&format!("_{ts}")))
                        .map(|(stem, _)| stem.clone())
                })
                .or_else(|| dbs.first().map(|(stem, _)| stem.clone()));
            let pair = Pair { code, db };
            if pair.is_empty() {
                return Err(Error::msg("远端没有任何可用的备份"));
            }
            Ok(pair)
        }
    }
}

/// 回滚：停服 → 恢复（数据库、代码）→ 起服。
///
/// 服务控制集中在这里，`restore_db` / `restore_code` 只做文件操作 ——
/// 这样"两边都要恢复"时不会停/起两次。
pub fn apply(cfg: &Config, remote: &Remote, pair: &Pair) -> Result<()> {
    stop_service(cfg, remote)?;
    if let Some(db) = &pair.db {
        restore_db(cfg, remote, db)?;
    }
    if let Some(code) = &pair.code {
        restore_code(cfg, remote, code)?;
    }
    start_service(cfg, remote)
}

pub fn stop_service(cfg: &Config, remote: &Remote) -> Result<()> {
    remote.ok(&format!(
        "sudo systemctl stop {} 2>/dev/null || true",
        sh_quote(&cfg.app_name)
    ))
}

pub fn start_service(cfg: &Config, remote: &Remote) -> Result<()> {
    let app = sh_quote(&cfg.app_name);
    remote.ok(&format!(
        "sudo systemctl restart {app} 2>/dev/null || sudo systemctl start {app}"
    ))
}

/// 恢复代码：从 `$BACKUP_DIR/<stem>.tar.gz` 还原 `brainbow`（有 `dist/` 就一起）。
///
/// 只做文件操作，不碰服务状态（见 `apply`）。
pub fn restore_code(cfg: &Config, remote: &Remote, stem: &str) -> Result<()> {
    let archive = format!("{}/{stem}.tar.gz", cfg.backup_dir);
    if !remote.exists(&archive) {
        return Err(Error::msg(format!("代码备份不存在：{archive}")));
    }

    let staging = format!("{}/rollback_{}", cfg.remote_tmp_dir(), utc_stamp());
    remote.ok(&format!("mkdir -p {}", sh_quote(&cfg.remote_tmp_dir())))?;
    remote.ok(&format!(
        "rm -rf {s} && mkdir -p {s}",
        s = sh_quote(&staging)
    ))?;

    // 先解到暂存目录：解包失败或内容不对时，运行目录一点没被动过
    ui::info("解出代码备份到暂存目录…");
    remote.ok(&format!(
        "tar -xzf {} -C {}",
        sh_quote(&archive),
        sh_quote(&staging)
    ))?;

    let staged_binary = path_of(&staging, "brainbow");
    if !remote.condition(&format!("[ -s {} ]", sh_quote(&staged_binary))) {
        let _ = remote.ok(&format!("rm -rf {}", sh_quote(&staging)));
        return Err(Error::msg(format!(
            "备份 {stem} 里没有 brainbow 二进制，已中止（运行目录未受影响）"
        )));
    }

    // 只动这两个路径。mv 在同一文件系统内是原子改名。
    remote.ok(&format!(
        "mv -f {} {}",
        sh_quote(&staged_binary),
        sh_quote(&path_of(&cfg.service_dir, "brainbow"))
    ))?;

    let staged_dist = path_of(&staging, "dist");
    if remote.exists(&staged_dist) {
        let live = path_of(&cfg.service_dir, "dist");
        let old = path_of(&cfg.service_dir, "dist.old");
        remote.ok(&format!(
            "rm -rf {o} && mv {l} {o}",
            o = sh_quote(&old),
            l = sh_quote(&live)
        ))?;
        remote.ok(&format!(
            "mv {} {}",
            sh_quote(&staged_dist),
            sh_quote(&live)
        ))?;
        remote.ok(&format!("rm -rf {}", sh_quote(&old)))?;
    }

    let _ = remote.ok(&format!("rm -rf {}", sh_quote(&staging)));
    remote.ok(&format!(
        "chmod 755 {}",
        sh_quote(&path_of(&cfg.service_dir, "brainbow"))
    ))?;
    ui::done(&format!("代码已恢复为 {stem}（uploads/ 与 bin/ 未动）"));
    Ok(())
}

/// 恢复数据库：从 `$BACKUP_DIR/<stem>.db` 覆盖现网库。
///
/// 覆盖前先删掉目标的 `-wal`/`-shm`：旧 WAL 在新主库上做恢复会重放旧事务
/// （deploy.sh 的审计 D2 记的正是这个），然后把备份自己的兄弟文件带回去。
/// 同样只做文件操作，不碰服务状态。
pub fn restore_db(cfg: &Config, remote: &Remote, stem: &str) -> Result<()> {
    let archive = format!("{}/{stem}.db", cfg.backup_dir);
    if !remote.exists(&archive) {
        return Err(Error::msg(format!("数据库备份不存在：{archive}")));
    }

    let live = cfg.database_path();
    ui::info(&format!("恢复数据库：{stem}.db"));

    // 坏备份不带病恢复：先体检（没有 sqlite3 就只告警放行，与老脚本一致）
    if let Ok(Some((out, _))) = remote.capture_any(&format!(
        "command -v sqlite3 >/dev/null 2>&1 && sqlite3 {} 'PRAGMA quick_check;' || echo ok",
        sh_quote(&archive)
    )) && out.trim() != "ok"
    {
        return Err(Error::msg(format!(
            "备份库 quick_check 未通过，中止恢复：\n{out}"
        )));
    }

    remote.ok(&format!("rm -f {l}-wal {l}-shm", l = sh_quote(&live)))?;
    let sibling = |suffix: &str| {
        format!(
            "{{ [ ! -f {s} ] || cp {s} {d}; }}",
            s = sh_quote(&format!("{archive}{suffix}")),
            d = sh_quote(&format!("{live}{suffix}")),
        )
    };
    remote.ok(&format!(
        "cp {src} {l} && {wal} && {shm}",
        src = sh_quote(&archive),
        l = sh_quote(&live),
        wal = sibling("-wal"),
        shm = sibling("-shm"),
    ))?;
    ui::done("数据库已恢复");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    #[test]
    fn picks_latest_code_and_its_paired_db() {
        let dbs = names(&[
            "db_deploy_20260921_100000.db",
            "db_deploy_20260920_100000.db",
            "db_manual_20260919_100000.db",
        ]);
        let codes = names(&["code_20260921_100000.tar.gz", "code_20260920_100000.tar.gz"]);
        let pair = pick(&dbs, &codes, None).expect("应当挑得出来");
        assert_eq!(
            pair,
            Pair {
                code: Some("code_20260921_100000".into()),
                db: Some("db_deploy_20260921_100000".into()),
            }
        );
    }

    #[test]
    fn falls_back_to_newest_db_when_stamp_has_no_pair() {
        // 代码备份的时间戳在数据库备份里没有对应项（比如手工删过）
        let dbs = names(&["db_deploy_20260920_100000.db"]);
        let codes = names(&["code_20260921_100000.tar.gz"]);
        let pair = pick(&dbs, &codes, None).expect("应当挑得出来");
        assert_eq!(pair.code.as_deref(), Some("code_20260921_100000"));
        assert_eq!(pair.db.as_deref(), Some("db_deploy_20260920_100000"));
    }

    #[test]
    fn picks_by_explicit_stamp() {
        let dbs = names(&[
            "db_deploy_20260921_100000.db",
            "db_prepush_20260920_090000.db",
        ]);
        let codes = names(&["code_20260921_100000.tar.gz", "code_20260920_090000.tar.gz"]);
        let pair = pick(&dbs, &codes, Some("20260920_090000")).expect("应当挑得出来");
        assert_eq!(
            pair,
            Pair {
                code: Some("code_20260920_090000".into()),
                db: Some("db_prepush_20260920_090000".into()),
            }
        );
    }

    #[test]
    fn unknown_stamp_is_an_error() {
        let dbs = names(&["db_deploy_20260921_100000.db"]);
        let codes = names(&["code_20260921_100000.tar.gz"]);
        let err = pick(&dbs, &codes, Some("20200101_000000")).expect_err("应当报错");
        assert!(err.to_string().contains("找不到时间戳"), "{err}");
    }

    #[test]
    fn code_only_when_there_is_no_db_backup() {
        let dbs: Vec<String> = Vec::new();
        let codes = names(&["code_20260921_100000.tar.gz"]);
        let pair = pick(&dbs, &codes, None).expect("应当挑得出来");
        assert_eq!(pair.db, None);
        assert!(pair.describe().contains("仅代码"), "{}", pair.describe());
    }

    #[test]
    fn undated_files_are_ignored() {
        // 解析不出时间戳的备份不参与挑选（判断不了新旧）
        let dbs = names(&["db_weird.db"]);
        let codes = names(&["brb_backup_2026_09_21.tar.gz"]);
        let err = pick(&dbs, &codes, None).expect_err("应当报错");
        assert!(err.to_string().contains("没有任何可用的备份"), "{err}");
    }

    #[test]
    fn empty_pair_is_reported() {
        let empty = Pair {
            code: None,
            db: None,
        };
        assert!(empty.is_empty());
        assert!(empty.describe().contains("无可恢复项"));
    }
}
