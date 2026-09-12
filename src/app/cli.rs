//! 命令行入口解析。
//!
//! 目前只有两种运行模式：
//! - 无参数：正常启动服务
//! - `--check`：只读自检（不迁移、不写文件），供部署与运维排查；有问题时以非零码退出

/// 运行模式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    /// 启动 HTTP 服务
    Serve,
    /// 只读自检并退出
    Check,
    /// 打印用法
    Help,
}

///  usage 文本（`--help` 与参数错误时输出）
pub const USAGE: &str = "\
BRainbow 后端

用法:
  brainbow              启动服务
  brainbow --check      只读自检：数据库 schema/完整性 + 上传目录 + 存储一致性
  brainbow --help       显示本帮助

环境变量见 .env.dev.example / .env.prod.example（DATABASE_URL、UPLOAD_DIR、SERVICE_PORT 等）";

/// 解析命令行参数（`args` 不含程序名本身）。
///
/// 未知参数返回 `Err`，由调用方打印用法并以非零码退出。
pub fn parse_args<I>(args: I) -> Result<Command, String>
where
    I: IntoIterator<Item = String>,
{
    let mut command = Command::Serve;
    for arg in args {
        match arg.as_str() {
            "--check" => command = Command::Check,
            "-h" | "--help" => return Ok(Command::Help),
            other => return Err(format!("未知参数: {other}")),
        }
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(args: &[&str]) -> Result<Command, String> {
        parse_args(args.iter().map(|s| (*s).to_string()))
    }

    #[test]
    fn no_args_means_serve() {
        assert_eq!(parse(&[]).unwrap(), Command::Serve);
    }

    #[test]
    fn check_flag_selects_check_mode() {
        assert_eq!(parse(&["--check"]).unwrap(), Command::Check);
    }

    #[test]
    fn help_flag_wins() {
        assert_eq!(parse(&["-h"]).unwrap(), Command::Help);
        assert_eq!(parse(&["--help"]).unwrap(), Command::Help);
        assert_eq!(parse(&["--check", "--help"]).unwrap(), Command::Help);
    }

    #[test]
    fn unknown_flag_is_rejected() {
        let err = parse(&["--nope"]).unwrap_err();
        assert!(err.contains("--nope"));
        assert!(USAGE.contains("--check"));
    }
}
