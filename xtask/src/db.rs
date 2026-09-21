//! 远端 SQLite 操作：体检、备份、保留策略。
//!
//! 对应 deploy.sh 的 `db_has_sqlite3` / `db_quick_check` / `db_backup` /
//! `db_optimize` / `prune_backups`（112-218）。
//!
//! 与老实现的两处差别：
//! - sqlite3 是否存在只探**一次**（老脚本每个操作都探一次，每次多一个 ssh 往返）；
//! - **保留策略在本地算**（`prune` 的判定是纯函数并可单测），只把要删的文件名
//!   发下去。老脚本用远端循环 + `sed` 解析时间戳，且 `db_*.db` 的 glob 匹配不到
//!   `-wal`/`-shm` 兄弟文件，于是它们永远不会被回收。

use chrono::{NaiveDateTime, Utc};

use crate::config::Config;
use crate::error::{Error, Result};
use crate::remote::{Remote, list_files, path_of, sh_quote};
use crate::stamp;
use crate::ui;

pub struct Db<'a> {
    remote: &'a Remote,
    cfg: &'a Config,
    has_sqlite3: bool,
}

/// 备份校验的结论。
///
/// "没跑成"要能与"通过"分开：远端没有 sqlite3 或 dry-run 时说一句"通过"，
/// 正好掩盖了这个检查的意义。
#[derive(Debug, PartialEq, Eq)]
pub enum Check {
    /// 读出了结论：这份备份是好的。
    Good,
    /// 没跑成（dry-run / 远端没有 sqlite3）。
    Skipped,
}

impl<'a> Db<'a> {
    /// 探一次远端有没有 sqlite3（没有就降级成 `cp` 备份 + 跳过体检）。
    ///
    /// dry-run 下探不出结果，按"有"处理 —— 别报一个假的"远端没有 sqlite3"。
    pub fn new(remote: &'a Remote, cfg: &'a Config) -> Result<Self> {
        let has_sqlite3 = match remote
            .capture_if_run("command -v sqlite3 >/dev/null 2>&1 && echo yes || echo no")?
        {
            None => true,
            Some(out) => {
                if out != "yes" {
                    ui::warn(
                        "远端没有 sqlite3：体检/优化会跳过，备份退化为直接 cp（含 -wal/-shm）",
                    );
                }
                out == "yes"
            }
        };
        Ok(Self {
            remote,
            cfg,
            has_sqlite3,
        })
    }

    /// 远端数据库文件。
    pub fn path(&self) -> String {
        self.cfg.database_path()
    }

    pub fn exists(&self) -> bool {
        self.remote.exists(&self.path())
    }

    /// `PRAGMA quick_check`：坏库不该被备份、更不该被新版本覆盖。
    ///
    /// 远端没有 sqlite3 时只告警并放行（老脚本同样如此）。
    pub fn quick_check(&self) -> Result<()> {
        if !self.has_sqlite3 {
            ui::warn("跳过 quick_check（远端没有 sqlite3）");
            return Ok(());
        }
        let cmd = format!("sqlite3 {} 'PRAGMA quick_check;'", sh_quote(&self.path()));
        match self.remote.capture_if_run(&cmd)? {
            None => {
                ui::info("数据库 quick_check（dry-run 未执行）");
                Ok(())
            }
            Some(out) if is_ok_output(&out) => Ok(()),
            Some(out) => Err(Error::msg(format!(
                "数据库 quick_check 未通过，中止（可先跑 `just db-check`）：\n  {out}"
            ))),
        }
    }

    /// 校验一份**已经躺在备份目录里的**文件（传文件名）。
    ///
    /// 部署收尾用它验刚拍的那份：`backup_at` 只对**源库**做过 quick_check，
    /// 产出的文件要到 `rollback::restore_db` 才被检查 —— 那时已经晚了，
    /// 坏备份等于没备份。
    pub fn verify_backup(&self, name: &str) -> Result<Check> {
        if !self.has_sqlite3 {
            return Ok(Check::Skipped);
        }
        let path = format!("{}/{}", self.cfg.backup_dir, name);
        let cmd = format!("sqlite3 {} 'PRAGMA quick_check;'", sh_quote(&path));
        match self.remote.capture_if_run(&cmd)? {
            None => Ok(Check::Skipped), // dry-run
            Some(out) if is_ok_output(&out) => Ok(Check::Good),
            Some(out) => Err(Error::msg(format!(
                "{name} 的 quick_check 未通过：\n{}",
                out.trim()
            ))),
        }
    }

    /// 远端库的 `PRAGMA user_version`（schema 版本）。
    ///
    /// 部署用它判断"这次动过 schema 没有"：动过的话，回滚代码必须连数据库一起回
    /// —— 库版本高于程序支持版本时启动会直接失败（见 `db::migrations`），
    /// 于是"旧代码 + 新库"这个组合必然起不来。
    ///
    /// 远端没有 sqlite3、或输出认不出来时返回 `None`：调用方按"动过"处理。
    pub fn user_version(&self) -> Option<i64> {
        if !self.has_sqlite3 {
            return None;
        }
        let cmd = format!("sqlite3 {} 'PRAGMA user_version;'", sh_quote(&self.path()));
        parse_user_version(&self.remote.capture_if_run(&cmd).ok().flatten()?)
    }

    /// `PRAGMA integrity_check`：全库逐页扫描，比 quick_check 慢得多，
    /// 所以只在 `just db-check` 里显式跑，不进部署路径。
    pub fn integrity_check(&self) -> Result<()> {
        if !self.has_sqlite3 {
            return Err(Error::msg("远端没有 sqlite3，无法做完整性检查"));
        }
        let cmd = format!(
            "sqlite3 {} 'PRAGMA integrity_check;'",
            sh_quote(&self.path())
        );
        match self.remote.capture_if_run(&cmd)? {
            None => {
                ui::info("完整性检查（dry-run 未执行）");
                Ok(())
            }
            Some(out) if out.trim() == "ok" => {
                ui::done("完整性检查通过（ok）");
                Ok(())
            }
            Some(out) => Err(Error::msg(format!("完整性检查未通过：\n{out}"))),
        }
    }

    /// 在远端做一份**一致性**快照。
    ///
    /// `sqlite3 .backup` 优先：它走 SQLite 的备份 API，读到的是**包含 WAL 中
    /// 已提交事务**的一致视图，所以不需要再带 `-wal`/`-shm` 兄弟文件。
    /// 远端没有 sqlite3 时退回 `cp`（裸拷贝），那时必须把兄弟文件一起带上。
    pub fn snapshot(&self, dest: &str) -> Result<()> {
        let src = self.path();
        let src_q = sh_quote(&src);
        let dest_q = sh_quote(dest);

        let cmd = if self.has_sqlite3 {
            // `.backup` 是 SQLite 的点命令：单引号给 shell，点命令的参数直接写
            // 字面路径（不再引一层 —— 引了就得指望 SQLite 自己剥引号，太绕）。
            let arg = sqlite_dot_arg(dest)?;
            format!("rm -f {dest_q} && sqlite3 {src_q} '.backup {arg}'")
        } else {
            let sibling = |suffix: &str| {
                format!(
                    "{{ [ ! -f {s} ] || cp {s} {d}; }}",
                    s = sh_quote(&format!("{src}{suffix}")),
                    d = sh_quote(&format!("{dest}{suffix}")),
                )
            };
            format!(
                "rm -f {dest_q} {wal_old} {shm_old} && cp {src_q} {dest_q} && {wal} && {shm}",
                wal_old = sh_quote(&format!("{dest}-wal")),
                shm_old = sh_quote(&format!("{dest}-shm")),
                wal = sibling("-wal"),
                shm = sibling("-shm"),
            )
        };
        self.remote.ok(&cmd)
    }

    /// `PRAGMA optimize`：更新统计信息，让查询计划器有数可依。
    pub fn optimize(&self) -> Result<()> {
        if !self.has_sqlite3 {
            ui::warn("跳过 PRAGMA optimize（远端没有 sqlite3）");
            return Ok(());
        }
        let cmd = format!("sqlite3 {} 'PRAGMA optimize;'", sh_quote(&self.path()));
        self.remote.ok(&cmd)
    }

    /// 一致性备份：`sqlite3 .backup` 优先（在线安全），没有 sqlite3 就 `cp`。
    ///
    /// 两条路都会带上 `-wal`/`-shm` 兄弟文件 —— 少了它们，备份库可能丢掉
    /// 尚未 checkpoint 的事务。
    pub fn backup(&self, suffix: &str) -> Result<String> {
        self.backup_at(suffix, &utc_stamp())
    }

    /// 同上，但用调用方给的时间戳。
    ///
    /// 部署路径会传自己的时间戳进来，让 `db_deploy_<ts>.db` 与
    /// `code_<ts>.tar.gz` **共用同一个 ts** —— 回滚就是按这个 ts 配对的。
    /// 各自取一次 `date` 的话两者会差几秒，于是 `just rollback <ts>` 只找得到
    /// 代码、找不到数据库（只剩"取最新一份"的兜底）。
    pub fn backup_at(&self, suffix: &str, stamp: &str) -> Result<String> {
        // 坏库不带病备份（老脚本的注释原话）
        self.quick_check()?;

        let name = stamp::db_filename(suffix, stamp);
        let dest = format!("{}/{}", self.cfg.backup_dir, name);
        ui::info(&format!("备份数据库 → {name}…"));

        self.snapshot(&dest).map_err(|e| {
            Error::msg(format!("数据库备份失败（已中止，不带着坏备份往下走）：{e}"))
        })?;

        let size = self
            .remote
            .capture_if_run(&format!("du -h {} 2>/dev/null | cut -f1", sh_quote(&dest)))
            .ok()
            .flatten()
            .unwrap_or_else(|| "?".into());
        ui::done(&format!("数据库已备份：{name}（{size}）"));
        Ok(name)
    }

    /// 按"天数 + 份数"清理备份，连 `-wal`/`-shm` 兄弟文件一起。
    pub fn prune(&self) -> Result<()> {
        let dir = &self.cfg.backup_dir;
        // **每类各算各的**：数据库备份与代码备份各自保留最新 N 份
        // （老脚本也是分开清的两条 `ls -1t … | tail -n +N`）。合成一个池子
        // 会让两类互相挤占名额，等于把保留份数减半。
        let mut doomed: Vec<String> = Vec::new();
        for pattern in ["db_*.db", "code_*.tar.gz"] {
            let names = self.list(dir, pattern)?;
            doomed.extend(stale(
                &names,
                Utc::now().naive_utc(),
                self.cfg.backup_retain_days,
                self.cfg.backup_retain_count,
            ));
        }
        if doomed.is_empty() {
            return Ok(());
        }

        let targets = prune_targets(dir, &doomed);
        self.remote.ok(&format!("rm -f {}", targets.join(" ")))?;
        ui::info(&format!(
            "清理了 {} 份过期备份（每类各保留 {} 天 / 最多 {} 份）",
            doomed.len(),
            self.cfg.backup_retain_days,
            self.cfg.backup_retain_count
        ));
        Ok(())
    }

    fn list(&self, dir: &str, pattern: &str) -> Result<Vec<String>> {
        list_files(self.remote, dir, pattern)
    }
}

/// 把要删的文件名展开成 `rm -f` 的实参。
///
/// 数据库备份连 `-wal`/`-shm` 一起点掉：`db_*.db` 这个 glob 匹配不到兄弟文件，
/// 只删主文件会让它们越积越多（老脚本正是如此）。
///
/// 传进来的必须是**文件名**（见 `remote::list_files`）；早先这里收到的是完整
/// 路径却又拼了一次目录，于是 `rm -f` 全打在不存在的路径上、静默失效 ——
/// 删除没生效，而日志照样报"清理了 N 份"。
fn prune_targets(dir: &str, names: &[String]) -> Vec<String> {
    let mut targets = Vec::new();
    for name in names {
        targets.push(sh_quote(&path_of(dir, name)));
        if name.ends_with(".db") {
            targets.push(sh_quote(&path_of(dir, &format!("{name}-wal"))));
            targets.push(sh_quote(&path_of(dir, &format!("{name}-shm"))));
        }
    }
    targets
}

/// UTC 时间戳，与老脚本的 `date -u +%Y%m%d_%H%M%S` 同格式。
pub fn utc_stamp() -> String {
    Utc::now().format("%Y%m%d_%H%M%S").to_string()
}

/// SQLite 点命令（`.backup …`）里的路径参数。
///
/// 调用处已经用 shell 单引号把整条点命令包住，所以这里只需拒绝会让那层单引号
/// 失效的字符。备份路径由配置与时间戳拼成，正常不会有这些字符 —— 真遇到了
/// 宁可拒绝，也不要拼出一条会往奇怪位置写文件的命令。
fn sqlite_dot_arg(path: &str) -> Result<String> {
    if path.contains('\'') {
        return Err(Error::msg(format!(
            "备份路径含单引号，无法安全拼进 SQLite 点命令：{path}"
        )));
    }
    Ok(path.to_string())
}

/// `quick_check` / `integrity_check` 的输出是不是"库是好的"。
///
/// 认出问题时会列出错误行（不是 "ok"），所以只认这一个词；单独拎出来是为了
/// 两处检查（现网库、备份文件）用同一条判据。
fn is_ok_output(text: &str) -> bool {
    text.trim() == "ok"
}

/// 解析 `PRAGMA user_version` 的输出（真实输出是 `19`，可能带换行）。
///
/// 认不出来就返回 `None`，**不猜**：调用方（部署的自动恢复）拿 `None` 时的
/// 动作是"连数据库一起回滚"，猜错要比不猜贵。
fn parse_user_version(text: &str) -> Option<i64> {
    text.trim().parse().ok()
}

/// 判定哪些备份该删。
///
/// 规则（与 deploy.sh 的两轮清理等价，但可单测）：
/// 1. 只保留最新的 `retain_count` 份；
/// 2. 早于 `retain_days` 天的一律删掉；
/// 3. **解析不出时间戳的文件一律不动** —— 无法判断新旧时，宁可不删。
fn stale(
    names: &[String],
    now: NaiveDateTime,
    retain_days: u32,
    retain_count: usize,
) -> Vec<String> {
    let mut dated: Vec<(&String, NaiveDateTime)> = names
        .iter()
        .filter_map(|name| stamp::parse(name).map(|at| (name, at)))
        .collect();
    // 新的在前
    dated.sort_by_key(|(_, at)| std::cmp::Reverse(*at));

    let cutoff = now - chrono::Duration::days(i64::from(retain_days));
    dated
        .into_iter()
        .enumerate()
        .filter(|(index, (_, at))| *index >= retain_count || *at < cutoff)
        .map(|(_, (name, _))| name.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_string()).collect()
    }

    fn at(text: &str) -> NaiveDateTime {
        stamp::parse(text).expect("测试用名字应当可解析")
    }

    #[test]
    fn keeps_everything_when_under_both_limits() {
        let list = names(&[
            "db_deploy_20260921_100000.db",
            "db_deploy_20260920_100000.db",
            "code_20260919_100000.tar.gz",
        ]);
        let doomed = stale(&list, at("db_x_20260921_120000.db"), 30, 20);
        assert!(doomed.is_empty(), "{doomed:?}");
    }

    #[test]
    fn prunes_by_count_keeping_the_newest() {
        let list = names(&[
            "db_deploy_20260921_100000.db",
            "db_deploy_20260920_100000.db",
            "db_deploy_20260919_100000.db",
            "db_deploy_20260918_100000.db",
        ]);
        let doomed = stale(&list, at("db_x_20260921_120000.db"), 3650, 2);
        assert_eq!(
            doomed,
            vec![
                "db_deploy_20260919_100000.db".to_string(),
                "db_deploy_20260918_100000.db".to_string(),
            ]
        );
    }

    #[test]
    fn prunes_by_age_even_when_count_allows_it() {
        let list = names(&[
            "db_deploy_20260921_100000.db",
            "db_deploy_20260701_100000.db",
        ]);
        let doomed = stale(&list, at("db_x_20260921_120000.db"), 30, 20);
        assert_eq!(doomed, vec!["db_deploy_20260701_100000.db".to_string()]);
    }

    #[test]
    fn never_prunes_undated_files() {
        // 解析不出时间戳 → 判断不了新旧 → 不动。宁可留着一个奇怪的备份，
        // 也不要按"看起来像备份"删掉用户的东西。
        let list = names(&["db_weird.db", "code_20260921_100000.tar.gz"]);
        let doomed = stale(&list, at("db_x_20260921_120000.db"), 0, 0);
        assert_eq!(doomed, vec!["code_20260921_100000.tar.gz".to_string()]);
    }

    #[test]
    fn day_and_count_rules_both_apply() {
        // 保留 2 份、30 天：最老的既超数也超期，只删它。
        let list = names(&[
            "db_deploy_20260921_100000.db",
            "db_deploy_20260920_100000.db",
            "db_deploy_20260801_100000.db",
        ]);
        let doomed = stale(&list, at("db_x_20260921_120000.db"), 30, 2);
        assert_eq!(doomed, vec!["db_deploy_20260801_100000.db".to_string()]);
    }

    #[test]
    fn prune_targets_use_file_names_not_paths() {
        // 回归：这里必须收到文件名。曾经收到完整路径又拼了一次目录，
        // 结果 rm 打在 `/dir//dir/file` 上，而 `rm -f` 对不存在的路径不报错。
        let targets = prune_targets(
            "/opt/brb/backup",
            &[
                "db_deploy_20260921_100000.db".to_string(),
                "code_20260920_100000.tar.gz".to_string(),
            ],
        );
        assert_eq!(
            targets,
            vec![
                "'/opt/brb/backup/db_deploy_20260921_100000.db'",
                "'/opt/brb/backup/db_deploy_20260921_100000.db-wal'",
                "'/opt/brb/backup/db_deploy_20260921_100000.db-shm'",
                "'/opt/brb/backup/code_20260920_100000.tar.gz'",
            ]
        );
        assert!(
            targets
                .iter()
                .all(|arg| arg.matches("/opt/brb/backup").count() == 1),
            "每个路径只应出现一次目录前缀：{targets:?}"
        );
    }

    #[test]
    fn utc_stamp_has_the_expected_shape() {
        let stamp = utc_stamp();
        assert_eq!(stamp.len(), 15);
        assert_eq!(stamp.as_bytes()[8], b'_');
        assert!(stamp::parse(&format!("db_deploy_{stamp}.db")).is_some());
    }

    #[test]
    fn user_version_parses_real_output_only() {
        assert_eq!(parse_user_version("19\n"), Some(19));
        assert_eq!(parse_user_version("19"), Some(19));
        assert_eq!(parse_user_version(" 0 "), Some(0));
        // 认不出来就是 None —— 调用方按"动过 schema"处理，不能猜成 0
        assert_eq!(parse_user_version(""), None);
        assert_eq!(parse_user_version("19\n20"), None);
        assert_eq!(
            parse_user_version("Error: unable to open database file"),
            None
        );
    }

    /// 只有干净通过才是 `ok` —— 出错时 sqlite3 列的是错误行，
    /// 别把"包含 ok 字样"当成通过。
    #[test]
    fn ok_output_is_exact() {
        assert!(is_ok_output("ok"));
        assert!(is_ok_output("ok\n"));
        assert!(is_ok_output("  ok  "));
        assert!(!is_ok_output(""));
        assert!(!is_ok_output(
            "*** in database main ***\nPage 3 is never used"
        ));
        assert!(!is_ok_output("ok\nPage 3 is never used"));
    }
}
