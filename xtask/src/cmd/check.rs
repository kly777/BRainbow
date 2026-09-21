//! `check` —— 部署前环境检查。
//!
//! 对应 deploy.sh 的 `cmd_check`（223-276），另加一项 **sudo 授权检查**。
//! 老脚本从不检查它，于是授权不全会以 `sudo: a password is required` 的形式
//! 在部署中途（服务已停、备份已做完）才炸出来 —— 而 ssh 不带 TTY，
//! 那时除了失败没有别的结果。
//!
//! 注意远端 sudoers 通常是**按命令**白名单授权（不是全量 NOPASSWD），
//! 所以不能用 `sudo -n true` 去探（它往往不在白名单里，会假报"要密码"），
//! 而要逐条核对部署真正用到的那几条命令。

use crate::cmd::{Report, brief};
use crate::config::Config;
use crate::error::Result;
use crate::remote::Remote;
use crate::ui;

/// 部署需要的 sudo 能力：`(sudo -n -l 输出里必须出现的片段, 用途)`。
///
/// 这些片段对应远端 sudoers 里的 `NOPASSWD:` 行。**改动下面任一处 sudo 调用形式
/// 都要同步这里**，也要同步确认 sudoers 仍然放行 —— 形式变了就匹配不上，
/// sudo 会退回要密码，而部署是无人值守的。
const REQUIRED_SUDO: &[(&str, &str)] = &[
    ("systemctl", "stop/start/restart/enable/daemon-reload 服务"),
    ("tee /etc/systemd/system", "安装 systemd unit"),
    ("chmod 600 /etc/systemd/system", "收紧 unit 权限（里面有 JWT 密钥）"),
    ("tee /etc/caddy/Caddyfile", "安装 Caddy 配置"),
];

pub fn run(cfg: &Config, remote: &Remote) -> Result<()> {
    ui::banner(&format!("环境检查 {} → {}", cfg.app_name, cfg.remote_host));
    let mut report = Report::default();

    // ── 1. SSH 可达 ──
    match remote.capture_if_run("echo ok") {
        Ok(None) => report.skip("SSH 可达"),
        Ok(Some(out)) if out == "ok" => report.pass("SSH 可达"),
        Ok(Some(out)) => report.fail(&format!("SSH 可达但响应异常：{out:?}")),
        Err(e) => report.fail(&format!(
            "SSH 不可达（{}:{}）—— {}",
            cfg.remote_host,
            cfg.remote_port,
            brief(&e)
        )),
    }

    // ── 2. sudo 授权（逐条核对白名单）──
    sudo_check(remote, &mut report);

    // ── 3. Caddy 已安装 ──
    match remote.capture_if_run("command -v caddy 2>/dev/null") {
        Ok(None) => report.skip("Caddy 已安装"),
        Ok(Some(path)) => report.pass(&format!("Caddy 已安装（{path}）")),
        Err(e) => report.fail(&format!(
            "远端没有 caddy —— {}；前端静态文件与 /api 反代都由它承担",
            brief(&e)
        )),
    }

    // ── 4. Caddy 配置有效 ──
    // `timeout` 缺失时（非 GNU 环境）退回不带超时的调用，避免把"没装 timeout"
    // 误报成"配置无效"。
    let validate = "timeout 10 caddy validate --config /etc/caddy/Caddyfile 2>&1 \
                    || caddy validate --config /etc/caddy/Caddyfile 2>&1";
    match remote.capture_if_run(validate) {
        Ok(None) => report.skip("Caddy 配置有效"),
        Ok(Some(out)) if out.contains("Valid configuration") => {
            report.pass("Caddy 配置有效");
        }
        Ok(Some(out)) => report.fail(&format!(
            "Caddy 配置校验未通过：{}",
            out.lines().last().unwrap_or("（无输出）")
        )),
        Err(e) => report.fail(&format!("Caddy 配置校验失败 —— {}", brief(&e))),
    }

    // ── 5. Caddy 正在运行（只告警）──
    match remote.capture_if_run("systemctl is-active caddy || true") {
        Ok(None) => report.skip("Caddy 运行中"),
        Ok(Some(state)) if state == "active" => report.pass("Caddy 运行中"),
        Ok(Some(state)) => report.warn(&format!("Caddy 未在运行（is-active: {state}）")),
        Err(e) => report.warn(&format!("无法确认 Caddy 状态 —— {}", brief(&e))),
    }

    // ── 6/7. 本地产物（只告警：先检查后构建是很自然的顺序）──
    let binary = cfg.build_dir().join("brainbow");
    if binary.is_file() {
        report.pass(&format!("本地产物 {}", relative(cfg, &binary)));
    } else {
        report.warn(&format!(
            "{} 不存在（还没构建；`just build`）",
            relative(cfg, &binary)
        ));
    }

    let index = cfg.build_dir().join("dist").join("index.html");
    if index.is_file() {
        report.pass("本地前端产物 dist/index.html");
    } else {
        report.warn("build/dist/index.html 不存在（还没构建；`just build`）");
    }

    // ── 8. JWT_SECRET 已配置（只告警）──
    // 只有渲染 systemd unit 的部署路径需要它（unit 里要写进去）。
    // 放在这里是为了让"首次部署会被自动生成并写回 .env.prod"这件事在部署前就可见，
    // 而不是等部署时才动那个文件。
    match &cfg.jwt_secret {
        Some(_) => report.pass("JWT_SECRET 已配置"),
        None => report.warn(&format!(
            "{} 里没有 JWT_SECRET（首次部署会自动生成并写回）",
            cfg.env_file.display()
        )),
    }

    report.finish("环境检查通过")
}

/// 核对 sudo 白名单。
///
/// `sudo -n -l` 列出当前用户可执行的命令，无论有没有 NOPASSWD（列自己的权限
/// 本身不需要密码），所以这是唯一能**只读**验证"部署那几条 sudo 能不能免密跑"
/// 的办法。改动远端 sudoers 后重新跑一次 `just check` 即可确认。
fn sudo_check(remote: &Remote, report: &mut Report) {
    let rules = match remote.capture_if_run("sudo -n -l 2>&1") {
        Ok(None) => {
            report.skip("sudo 授权");
            return;
        }
        Ok(Some(rules)) => rules,
        Err(e) => {
            // 拿不到白名单不等于有问题（可能只是不允许 -l），所以只告警。
            report.warn(&format!(
                "无法列出 sudo 授权，跳过检查 —— {}",
                brief(&e)
            ));
            return;
        }
    };

    let missing: Vec<&(&str, &str)> = REQUIRED_SUDO
        .iter()
        .filter(|(needle, _)| !rules.contains(needle))
        .collect();

    if missing.is_empty() {
        report.pass(&format!("sudo 授权齐备（{} 项）", REQUIRED_SUDO.len()));
        return;
    }

    let detail = missing
        .iter()
        .map(|(needle, why)| format!("{why}（sudoers 需放行含 `{needle}` 的命令）"))
        .collect::<Vec<_>>()
        .join("；");
    report.fail(&format!(
        "sudo 免密授权不全，部署会在中途要密码 —— {detail}。\
         远端 sudoers 是按命令授权的，改动 sudo 调用形式后两边要对齐（见 deploy/README 或 just check）"
    ));
}

/// 相对仓库根显示路径，输出里少些绝对路径噪音。
fn relative(cfg: &Config, path: &std::path::Path) -> String {
    path.strip_prefix(&cfg.project_dir)
        .unwrap_or(path)
        .display()
        .to_string()
}
