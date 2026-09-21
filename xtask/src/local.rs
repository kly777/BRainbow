//! 本地子进程。
//!
//! 除了 `cargo` / `pnpm`，只用系统自带的命令 —— 并且**只在本机需要的地方**用
//! （`info` 的端点探测走本地 curl；Windows 10+ / macOS / Linux 都自带）。
//! 远端执行在 `remote.rs`。

use std::process::Command;

/// 跑一个本地命令，成功返回 stdout（已 trim），失败或命令不存在返回 `None`。
///
/// 用于"探测"：命令不存在不该 panic，而应变成一句可读的降级提示。
pub fn try_run(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 丢弃输出的目标。
///
/// `curl -o /dev/null` 在 Windows 上会去写 `\dev\null` 这个路径而不是丢弃，
/// 那里要用 `NUL`。
pub fn null_sink() -> &'static str {
    if cfg!(windows) { "NUL" } else { "/dev/null" }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn try_run_reports_success_and_failure() {
        // 用几乎必然存在的命令，且不依赖具体输出内容。
        if cfg!(unix) {
            assert!(try_run("true", &[]).is_some());
            assert!(try_run("false", &[]).is_none());
        }
        assert!(try_run("这个命令一定不存在-xtask", &[]).is_none());
    }

    #[test]
    fn null_sink_matches_platform() {
        assert_eq!(null_sink(), if cfg!(windows) { "NUL" } else { "/dev/null" });
    }
}
