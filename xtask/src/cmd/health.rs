//! `health` —— 部署后健康检查。
//!
//! 对应 deploy.sh 的 `cmd_health`（605-667）：4 项打分 + 3 行资源信息。
//!
//! 两处刻意的改进（都在下面注释里标了原因）：
//! 1. curl 一律带 `--connect-timeout/--max-time`，避免挂死的连接把检查卡住；
//! 2. **有检查不过时返回非零退出码** —— deploy.sh 无论成败都 exit 0，
//!    于是 `make health` 在脚本里毫无用处。

use crate::cmd::{Report, brief};
use crate::config::Config;
use crate::error::Result;
use crate::remote::{Remote, path_in, sh_quote};
use crate::ui;

/// `curl` 只回状态码；连不上时 `|| echo 000` 兜底（deploy.sh 同款做法）。
const CURL_CODE: &str = "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 10";

pub fn run(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("健康检查 {} → {}", cfg.app_name, cfg.remote_host));
    let mut report = Report::default();

    http_check(
        remote,
        &mut report,
        "后端 API (直连)",
        &format!("http://localhost:{}/api/health", cfg.service_port),
    );
    http_check(
        remote,
        &mut report,
        "后端 API (Caddy)",
        &format!("https://{}/api/health", cfg.domain),
    );
    http_check(
        remote,
        &mut report,
        "前端 SPA (Caddy)",
        &format!("https://{}/", cfg.domain),
    );
    service_check(remote, &mut report, cfg);

    resource_info(remote, cfg);

    if report.has_failures() {
        return report.finish("健康检查通过");
    }
    report.finish("全部正常")
}

fn http_check(remote: &Remote, report: &mut Report, label: &str, url: &str) {
    let cmd = format!("{CURL_CODE} {} 2>/dev/null || echo 000", sh_quote(url));
    match remote.capture_if_run(&cmd) {
        Ok(None) => report.skip(label),
        Ok(Some(code)) if code == "200" => report.pass(&format!("{label} → HTTP {code}")),
        Ok(Some(code)) => report.fail(&format!("{label} → HTTP {code}")),
        Err(e) => report.fail(&format!("{label} → {}", brief(&e))),
    }
}

fn service_check(remote: &Remote, report: &mut Report, cfg: &Config) {
    // `|| true`：服务没起来时 is-active 返回非零，这里要的是它的输出而不是退出码。
    let cmd = format!("systemctl is-active {} || true", sh_quote(&cfg.app_name));
    match remote.capture_if_run(&cmd) {
        Ok(None) => report.skip("systemd 服务运行中"),
        Ok(Some(state)) if state == "active" => report.pass("systemd 服务运行中"),
        Ok(Some(state)) => report.fail(&format!("systemd 服务未运行（is-active: {state}）")),
        Err(e) => report.fail(&format!("systemd 服务未运行 —— {}", brief(&e))),
    }
}

/// 仅信息展示，不计分。
fn resource_info(remote: &Remote, cfg: &Config) {
    // ps 的输出是「命令 CPU% MEM%」三列 —— 老脚本用 `${line#* }` 把它重新标成
    // "CPU=..." 其实标错了列，这里原样打印，不猜。
    if let Ok(Some(procs)) = remote.capture_if_run("ps aux | grep brainbow | grep -v grep | awk '{print $11, $3, $4}'") {
        for line in procs.lines().filter(|l| !l.trim().is_empty()) {
            ui::info(&format!("进程资源: {line}"));
        }
    }
    let size_of = |path: String| {
        remote
            .capture_if_run(&format!("ls -lh {path} 2>/dev/null | awk '{{print $5}}'"))
            .ok()
            .flatten()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "N/A".into())
    };
    ui::info(&format!(
        "二进制: {}",
        size_of(path_in(&cfg.service_dir, "brainbow"))
    ));
    ui::info(&format!(
        "数据库: {}",
        size_of(sh_quote(&cfg.database_path()))
    ));
}
