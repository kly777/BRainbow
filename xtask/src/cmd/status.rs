//! `status` / `logs` —— 远端服务状态与日志。
//!
//! 对应 deploy.sh 的 `cmd_status`（926-931）与 `cmd_logs`（917-921）。

use crate::config::Config;
use crate::error::Result;
use crate::remote::{Remote, sh_quote};
use crate::ui;

pub fn run_status(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("服务状态 {}", cfg.app_name));
    let cmd = format!(
        "sudo systemctl status {} --no-pager 2>&1 | head -20",
        sh_quote(&cfg.app_name)
    );
    print(remote, &cmd)?;
    ui::rule();
    print(remote, &journal_cmd(cfg, 10))?;
    Ok(())
}

pub fn run_logs(cfg: &Config, remote: &Remote, lines: u32) -> Result<()> {
    print(remote, &journal_cmd(cfg, lines))
}

fn journal_cmd(cfg: &Config, lines: u32) -> String {
    format!(
        "journalctl -u {} -n {lines} --no-pager",
        sh_quote(&cfg.app_name)
    )
}

fn print(remote: &Remote, cmd: &str) -> Result<()> {
    let out = remote.capture(cmd)?;
    if !out.is_empty() {
        ui::raw(&out);
    }
    Ok(())
}
