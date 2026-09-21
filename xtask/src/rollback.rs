//! 回滚：把代码（与数据库）退回某一份备份。
//!
//! 与 deploy.sh 的 `cmd_rollback`（672-807）相比的三处修正：
//!
//! 1. **临时目录建在 `$REMOTE_DIR/tmp` 下**。老写法用
//!    `$REMOTE_BASE/${APP_NAME}_rollback_$$`，也就是 `/opt/brb_rollback_<pid>`，
//!    而 ssh 用户对 `/opt` 没有写权限 —— 于是 `mkdir` 失败、`set -e` 直接中止，
//!    回滚**必然失败**（AGENTS.md 记的就是这一条，实际只剩"重启现有产物"那层）。
//! 2. **不再 `rm -rf $SERVICE_DIR`**。老写法重建整个服务目录，会连带删掉不在
//!    备份里的东西（`bin/ffmpeg`、`mem_config.json`）。这里只替换 `brainbow`
//!    与 `dist`，其余原样保留 —— 顺带也就不会丢 `bin/ffmpeg` 了。
//! 3. **代码备份与数据库备份按同一个时间戳配对**。老写法从数据库名反推代码名
//!    （`db_deploy_<ts>` → `code_deploy_<ts>`），可实际的代码备份叫
//!    `code_<ts>.tar.gz` —— 对不上，于是"回滚代码"这一步被静默跳过。
//!
//! 备份只含 `brainbow` + `dist/`（这是 `code_*.tar.gz` 的定义，也让它保持在
//! 十几 MB 而不是把 76MB 的 ffmpeg 一起打包）；因为第 2 点，`bin/` 不受影响。

use crate::config::Config;
use crate::db::utc_stamp;
use crate::error::{Error, Result};
use crate::remote::{Remote, path_of, sh_quote};
use crate::ui;

/// 恢复代码：从 `$BACKUP_DIR/<stem>.tar.gz` 还原 `brainbow`（有 `dist/` 就一起）。
///
/// `stem` 形如 `code_20260921_193500`。也会停服、重启，并等它就绪。
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

    let staged_binary = format!("{staging}/brainbow");
    if !remote.condition(&format!("[ -s {} ]", sh_quote(&staged_binary))) {
        let _ = remote.ok(&format!("rm -rf {}", sh_quote(&staging)));
        return Err(Error::msg(format!(
            "备份 {stem} 里没有 brainbow 二进制，已中止（运行目录未受影响）"
        )));
    }

    ui::info("停止服务…");
    remote.ok(&format!(
        "sudo systemctl stop {} 2>/dev/null || true",
        sh_quote(&cfg.app_name)
    ))?;

    // 只动这两个路径。mv 在同一文件系统内是原子改名。
    remote.ok(&format!(
        "mv -f {} {}",
        sh_quote(&staged_binary),
        sh_quote(&path_of(&cfg.service_dir, "brainbow"))
    ))?;

    let staged_dist = format!("{staging}/dist");
    if remote.exists(&staged_dist) {
        let live = format!("{}/dist", cfg.service_dir);
        let old = format!("{}/dist.old", cfg.service_dir);
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
