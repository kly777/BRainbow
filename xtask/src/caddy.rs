//! Caddy 配置同步。
//!
//! 与 deploy.sh 的 `sync_caddyfile`（518-534）相比的关键修正：
//! 老写法是**先** `sudo tee /etc/caddy/Caddyfile` 覆盖现网、**再** `caddy validate`
//! ——校验失败时它只是打印一句"保留旧配置运行"，可坏配置已经躺在磁盘上了
//! （运行中的 Caddy 还用着内存里的旧配置，于是下次重启或 reload 才炸）。
//!
//! 这里改成：候选配置先写到用户的暂存目录、在**那个文件**上校验，通过了才覆盖现网。

use crate::config::Config;
use crate::db::utc_stamp;
use crate::error::{Error, Result};
use crate::remote::{Remote, sh_quote};
use crate::ui;

/// 同步 Caddy 配置：校验候选 → 覆盖现网。
pub fn sync(cfg: &Config, remote: &Remote, content: &str) -> Result<()> {
    let tmp_dir = cfg.remote_tmp_dir();
    // 带时间戳的文件名：不用 /tmp 里的可预测路径（那类临时文件是经典隐患）
    let candidate = format!("{tmp_dir}/Caddyfile.{}.new", utc_stamp());
    remote.ok(&format!("mkdir -p {}", sh_quote(&tmp_dir)))?;
    remote.write_file(&candidate, content.as_bytes(), "Caddy 候选配置")?;

    // `timeout` 缺失时（非 GNU 环境）退回不带超时的调用
    let validate = format!(
        "timeout 10 caddy validate --config {c} 2>&1 || caddy validate --config {c} 2>&1",
        c = sh_quote(&candidate)
    );
    match remote.capture_if_run(&validate)? {
        // dry-run：命令没执行，不能判成"校验失败"（那会让 dry-run 以失败告终）
        None => ui::info("Caddy 候选配置校验（dry-run 未执行）"),
        Some(out) if out.contains("Valid configuration") => {}
        Some(out) => {
            let _ = remote.ok(&format!("rm -f {}", sh_quote(&candidate)));
            return Err(Error::msg(format!(
                "Caddy 候选配置校验未通过，现网配置未改动：\n{}",
                out.trim()
            )));
        }
    }

    // 校验通过才覆盖现网。命令形式必须与远端 sudoers 白名单一致
    // （`tee /etc/caddy/Caddyfile`），见 cmd/check.rs 的 REQUIRED_SUDO。
    remote.ok(&format!(
        "sudo tee /etc/caddy/Caddyfile < {} > /dev/null",
        sh_quote(&candidate)
    ))?;
    let _ = remote.ok(&format!("rm -f {}", sh_quote(&candidate)));
    ui::done("Caddy 配置已更新（校验通过后才覆盖）");
    Ok(())
}

/// 重载 Caddy：reload 不行就 restart。
pub fn reload(remote: &Remote) -> Result<()> {
    remote.ok("sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy")
}
