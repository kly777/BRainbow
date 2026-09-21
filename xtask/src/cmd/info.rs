//! `info` —— 部署信息汇总（状态 / 产物 / 数据 / 资源 / 配置 / 端点 / 日志）。
//!
//! 对应 deploy.sh 的 `cmd_info`（937-989）。
//!
//! 老脚本几乎每一行都是 `remote "… | sed 's/^/  /'" 2>/dev/null` ——
//! 用管道把远端命令的失败信息吞掉，再在远端做缩进。这里改成：**远端只取数据，
//! 排版在本地做**，于是拿不到数据时能明确显示占位符，而不是静默空白。

use crate::cmd::brief;
use crate::config::Config;
use crate::error::Result;
use crate::local;
use crate::remote::{Remote, basename, path_in, sh_quote};
use crate::ui;

pub fn run(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("部署信息 {} → {}", cfg.app_name, cfg.remote_host));

    let app = sh_quote(&cfg.app_name);
    let binary = path_in(&cfg.service_dir, "brainbow");

    ui::section("服务状态");
    show(
        remote,
        &format!(
            "systemctl is-active {app} || true; \
             systemctl show {app} -p ActiveEnterTimestamp -p MainPID -p MemoryCurrent \
             -p CPUUsageNS 2>/dev/null"
        ),
    );

    ui::section("构建产物");
    show(
        remote,
        &format!("ls -lh {binary} 2>/dev/null; stat -c '部署时间: %y' {binary} 2>/dev/null"),
    );
    show(
        remote,
        &format!(
            "ls -lh {} 2>/dev/null",
            path_in(&cfg.service_dir, "dist/index.html")
        ),
    );

    ui::section("数据");
    field(
        remote,
        "数据库",
        &format!("du -h {} 2>/dev/null | cut -f1", sh_quote(&cfg.database_path())),
        "N/A",
    );
    // 最近 3 份数据库备份：远端只列路径，名称与时间戳在本地格式化
    // （与 `list-backups` 用同一个格式化，两处显示一致）。
    let recent = remote.capture_if_run(&format!(
        "ls -1t {} 2>/dev/null | head -3",
        path_in(&cfg.backup_dir, "db_*.db")
    ))?;
    for line in recent.unwrap_or_default().lines().filter(|l| !l.is_empty()) {
        if let Some(name) = basename(line) {
            let label = crate::cmd::backups::stamp_label(name)
                .unwrap_or_else(|| name.to_string());
            ui::field("备份", &label);
        }
    }

    ui::section("资源");
    show(
        remote,
        &format!(
            "df -h {} 2>/dev/null | tail -1 | awk '{{print \"磁盘: 已用 \" $3 \" / \" $2 \" (\" $5 \")\"}}'",
            sh_quote(&cfg.service_dir)
        ),
    );

    ui::section("配置");
    config_section(cfg, remote);

    // ── 端点探测 ──
    // 这一段刻意在**本地**跑 curl（deploy.sh 亦然）：只有从外网走一遍域名，
    // 才真的经过 Cloudflare 与 TLS，也才验证了 Caddy 那一层。
    ui::section("端点探测");
    for endpoint in ["/api/health", "/", "/.well-known/api-catalog"] {
        let url = format!("https://{}{endpoint}", cfg.domain);
        let code = local::try_run(
            "curl",
            &[
                "-s",
                "-o",
                local::null_sink(),
                "-m",
                "5",
                "-w",
                "%{http_code}",
                &url,
            ],
        )
        .unwrap_or_else(|| "FAIL".to_string());
        println!("  {endpoint:<28} {code}");
    }

    ui::section("最近日志");
    show(
        remote,
        &format!("journalctl -u {app} -n 5 --no-pager 2>/dev/null"),
    );
    println!();
    Ok(())
}

/// 配置小节：拿 systemd **实际生效**的环境变量。
///
/// 刻意不去读 unit 文件：那个文件是 `600 root:root`，非 root 读不到 ——
/// deploy.sh 的 `grep JWT_SECRET /etc/systemd/system/x.service` 因此在远端
/// 永远 permission denied，于是永远误报"JWT_SECRET 未注入"。
/// `systemctl show -p Environment` 既不需要 root，给的又是 systemd 解析后的结果。
fn config_section(cfg: &Config, remote: &Remote) {
    let cmd = format!(
        "systemctl show {} -p Environment 2>/dev/null",
        sh_quote(&cfg.app_name)
    );
    let line = match remote.capture_if_run(&cmd) {
        Ok(None) => {
            ui::info("生效环境变量（dry-run 未执行）");
            return;
        }
        Ok(Some(line)) => line,
        Err(e) => {
            ui::warn(&format!("无法读取生效环境变量 —— {}", brief(&e)));
            return;
        }
    };

    let env = line.strip_prefix("Environment=").unwrap_or(&line);
    let tokens: Vec<&str> = env.split_whitespace().collect();
    if tokens.is_empty() {
        ui::warn("systemd 里没有任何 Environment（unit 可能是手工装上去的）");
        return;
    }

    if tokens.iter().any(|t| t.starts_with("JWT_SECRET=")) {
        ui::done("JWT_SECRET 已注入 systemd");
    } else {
        ui::warn("JWT_SECRET 未注入（重启后会话失效）");
    }
    ui::field(
        "环境",
        &tokens
            .iter()
            .map(|token| redact(token))
            .collect::<Vec<_>>()
            .join(" "),
    );
}

/// 把密钥的值打码 —— 输出里只留键名。
fn redact(token: &str) -> String {
    match token.split_once('=') {
        Some((key, _)) if key == "JWT_SECRET" => format!("{key}=<已隐藏>"),
        _ => token.to_string(),
    }
}

/// 打印远端输出；空输出与失败都静默跳过（这些行都是"有就显示"的信息项）。
fn show(remote: &Remote, cmd: &str) {
    if let Ok(Some(out)) = remote.capture_if_run(cmd)
        && !out.is_empty()
    {
        ui::raw(&out);
    }
}

/// `标签: 值`，拿不到值就用占位符 —— 比老脚本的静默空白更能说明问题。
fn field(remote: &Remote, label: &str, cmd: &str, fallback: &str) {
    let value = remote
        .capture_if_run(cmd)
        .ok()
        .flatten()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| fallback.to_string());
    ui::field(label, &value);
}
