//! 远端执行。
//!
//! 与 deploy.sh 的关键差别：**本地侧不再有 shell**。
//! 老脚本把 `SSH_CMD="ssh -p $PORT $USER@$HOST"` 拼成字符串再用 `$SSH_CMD "$@"`
//! 做词拆分，还处处 `eval` 拼 rsync 命令 —— 路径带空格就断。
//! 这里 ssh 用 **argv 数组**起（无 shell、无词拆分、无 eval）。
//!
//! 远端那一侧仍然是一条被远端 shell 解析的命令串，这是 ssh 的固有形态，
//! 所以**任何插值都必须过 `sh_quote`**；字面部分（`awk '{print $1}'` 之类）
//! 则可以是干净的原文，不再需要 deploy.sh 里那层层叠叠的 `\$` 转义。

use std::process::Command;

use crate::config::Config;
use crate::error::{Error, Result};
use crate::ui;

pub struct Remote<'a> {
    cfg: &'a Config,
    dry_run: bool,
}

impl<'a> Remote<'a> {
    pub fn new(cfg: &'a Config, dry_run: bool) -> Self {
        Self { cfg, dry_run }
    }

    /// 供 dry-run 展示与测试使用：完整的 ssh argv。
    pub fn argv(&self, cmd: &str) -> Vec<String> {
        vec![
            "-p".to_string(),
            self.cfg.remote_port.to_string(),
            self.cfg.target(),
            cmd.to_string(),
        ]
    }

    /// 执行远端命令并返回 stdout（已去掉首尾空白）。非零退出即失败。
    /// dry-run 时命令没跑，返回空串。
    pub fn capture(&self, cmd: &str) -> Result<String> {
        Ok(self.capture_if_run(cmd)?.unwrap_or_default())
    }

    /// 同 `capture`，但 dry-run 时返回 `None`。
    ///
    /// 给"按输出打分"的检查用：dry-run 下命令没执行，不该把空输出判成失败，
    /// 调用方看到 `None` 就报"未执行"。
    pub fn capture_if_run(&self, cmd: &str) -> Result<Option<String>> {
        Ok(self.exec(cmd)?.map(|(stdout, _)| stdout))
    }

    /// `Some((stdout, stderr))`；dry-run 时为 `None`（没有真的执行）。
    fn exec(&self, cmd: &str) -> Result<Option<(String, String)>> {
        if self.dry_run {
            ui::dry_run(&format!("ssh {}", self.argv(cmd).join(" ")));
            return Ok(None);
        }
        let output = Command::new("ssh")
            .args(self.argv(cmd))
            .output()
            .map_err(|e| Error::io("启动 ssh（确认 PATH 里有 OpenSSH 客户端）", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if !output.status.success() {
            let mut message = format!("远端命令执行失败（exit {}）：\n  {cmd}", exit_code(&output.status));
            // 失败原因可能走 stdout（命令里的 `2>&1`）也可能走 stderr，两处都带上，
            // 否则调用方只能看到一句"exit 1"而不知道原因。
            if !stdout.is_empty() {
                message.push_str("\n  输出: ");
                message.push_str(&indent(&stdout, "  "));
            }
            if !stderr.is_empty() {
                message.push_str("\n  stderr: ");
                message.push_str(&indent(&stderr, "  "));
            }
            return Err(Error::msg(message));
        }
        Ok(Some((stdout, stderr)))
    }
}

fn exit_code(status: &std::process::ExitStatus) -> String {
    match status.code() {
        Some(code) => code.to_string(),
        None => "信号终止".to_string(),
    }
}

/// 把多行文本缩进，便于嵌进错误信息。
fn indent(text: &str, prefix: &str) -> String {
    text.lines().collect::<Vec<_>>().join(&format!("\n{prefix}"))
}

/// 把一个值安全地嵌进**远端 shell** 的单引号里。
///
/// 单引号内除 `'` 外一切字符都是字面量（包括 `$`、反引号、`\`、空格、换行），
/// 而 `'` 本身用 `'\''` 表达（收尾 → 转义的单引号 → 重新开引号）。
pub fn sh_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// 拼一条远端命令里的 `路径/后缀`：目录本身走 `sh_quote`，后缀保持字面量。
///
/// 这样 `'$DIR'/name` 里的 glob 与文件名不会被引号吃掉
/// （写成 `'$DIR/name'` 会让 `db_*.db` 这样的模式不再展开）。
pub fn path_in(dir: &str, suffix: &str) -> String {
    format!("{}/{}", sh_quote(dir), suffix)
}

/// 取远端路径的最后一段。
///
/// **远端路径一律用 `/` 分隔，与本机是什么系统无关** —— 所以解析远端输出时
/// 必须按 `'/'` 切，不能走 `std::path`（在 Windows 上它会按 `\` 处理，
/// 于是 `/opt/brb/data/x.db` 会被当成一整段）。
pub fn basename(path: &str) -> Option<&str> {
    path.rsplit('/').next().filter(|s| !s.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_plain_value() {
        assert_eq!(sh_quote("/opt/brb/data"), "'/opt/brb/data'");
        assert_eq!(sh_quote(""), "''");
    }

    #[test]
    fn quotes_metacharacters_as_literals() {
        assert_eq!(sh_quote("a b"), "'a b'");
        assert_eq!(sh_quote("$HOME"), "'$HOME'");
        assert_eq!(sh_quote("a|b&c"), "'a|b&c'");
        assert_eq!(sh_quote("`id`"), "'`id`'");
        assert_eq!(sh_quote("a\\b"), "'a\\b'");
    }

    #[test]
    fn escapes_single_quote() {
        assert_eq!(sh_quote("it's"), "'it'\\''s'");
    }

    /// 真正过一遍 POSIX shell：证明 `sh_quote` 的转义是对的，
    /// 而不只是"看起来像对的"。（Windows 上没有 sh，跳过。）
    #[cfg(unix)]
    #[test]
    fn survives_a_real_shell_round_trip() {
        let samples = [
            "plain",
            "with space",
            "it's",
            "quote'quote'quote",
            "$VAR `cmd` ${x}",
            "a|b&c;d>e",
            "back\\slash",
            "换行\n和\t制表",
            "双引号\"与'单引号'",
        ];
        for sample in samples {
            let script = format!("printf '%s' {}", sh_quote(sample));
            let output = std::process::Command::new("sh")
                .arg("-c")
                .arg(&script)
                .output()
                .expect("本机应有 sh");
            assert!(output.status.success(), "sh 拒绝了: {script}");
            assert_eq!(
                String::from_utf8_lossy(&output.stdout),
                sample,
                "往返后内容变了: {script}"
            );
        }
    }

    #[test]
    fn path_in_keeps_suffix_literal() {
        // 目录被引起来，后缀（含 glob）保持字面量。
        assert_eq!(path_in("/opt/brb/backup", "db_*.db"), "'/opt/brb/backup'/db_*.db");
        assert_eq!(path_in("/opt/brb/service", "brainbow"), "'/opt/brb/service'/brainbow");
    }

    #[test]
    fn basename_splits_on_remote_separator() {
        // 远端路径始终是 '/'，不受本机（可能是 Windows）影响。
        assert_eq!(basename("/opt/brb/backup/db_deploy_20260921_193500.db"),
                   Some("db_deploy_20260921_193500.db"));
        assert_eq!(basename("brainbow"), Some("brainbow"));
        assert_eq!(basename(""), None);
        assert_eq!(basename("/"), None);
    }
}
