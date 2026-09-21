//! 终端输出。
//!
//! 用 `IsTerminal` / `NO_COLOR` 决定要不要上色，而不是无条件吐 ANSI 转义
//! （deploy.sh 的 `echo -e '\033[...m'` 在重定向到文件时会留一堆乱码）。

use std::io::IsTerminal;

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const GREEN: &str = "\x1b[0;32m";
const YELLOW: &str = "\x1b[0;33m";
const RED: &str = "\x1b[0;31m";
const CYAN: &str = "\x1b[0;36m";

fn colors_enabled() -> bool {
    std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none()
}

fn paint(code: &str, text: &str) -> String {
    if colors_enabled() {
        format!("{code}{text}{RESET}")
    } else {
        text.to_string()
    }
}

/// `═══` 横幅，与 deploy.sh 的观感保持一致。
pub fn banner(title: &str) {
    let rule = "═".repeat(43);
    println!("{rule}");
    println!("{}", paint(BOLD, title));
    println!("{rule}");
}

/// 进度说明（对应 deploy.sh 的 log_info）。
pub fn info(text: &str) {
    println!("{} {text}", paint(CYAN, "[信息]"));
}

/// 一件事做成了（对应 log_done）。
pub fn done(text: &str) {
    println!("{} {text}", paint(GREEN, "[完成]"));
}

/// 不阻断流程的问题（对应 log_warn）。
pub fn warn(text: &str) {
    println!("{} {text}", paint(YELLOW, "[警告]"));
}

/// 失败（对应 log_error）。
pub fn error(text: &str) {
    eprintln!("{} {text}", paint(RED, "[错误]"));
}

/// 失败项列表，配合 `Error::Many` 使用。
pub fn failures(items: &[String]) {
    error(&format!("有 {} 项失败：", items.len()));
    for item in items {
        eprintln!("  - {item}");
    }
}

/// `标签: 值` 的对齐输出（对应 info/logs 里那些 `echo "  后端: $x"`）。
pub fn field(label: &str, value: &str) {
    println!("  {} {value}", paint(DIM, &format!("{label}:")));
}

/// 直接打印远端输出，不做任何加工。
pub fn raw(text: &str) {
    println!("{text}");
}

/// dry-run 下打印"本该执行的命令"。
pub fn dry_run(text: &str) {
    println!("{} {text}", paint(YELLOW, "[dry-run]"));
}

/// 分隔线。
pub fn rule() {
    println!("{}", paint(DIM, "---"));
}

/// 交互确认。非 TTY（或被重定向）时一律返回 `false` —— 调用方据此提示用 `--yes`。
///
/// 比老脚本的 `read -r ans; [ "$ans" != "y" ]` 宽一点：`Y` 也算同意。
pub fn confirm(prompt: &str) -> bool {
    use std::io::Write;

    if !std::io::stdin().is_terminal() {
        return false;
    }
    print!("{prompt} (y/N) ");
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    if std::io::stdin().read_line(&mut line).is_err() {
        return false;
    }
    matches!(line.trim(), "y" | "Y")
}

/// 小节标题（对应 info 里那些 `echo "── 服务状态 ──"`）。
pub fn section(title: &str) {
    println!();
    println!("── {title} ──");
}
