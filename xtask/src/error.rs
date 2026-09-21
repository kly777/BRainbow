//! 统一的错误类型。
//!
//! 这个 crate 是 CLI，不需要给调用方分支用的机器可读错误码（那是服务端
//! `shared/error_types.rs` 的活）。这里只要"能打出一行给人看的原因"就够。

use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug)]
pub enum Error {
    /// 面向人的失败原因，直接打印这一行。
    Message(String),
    /// IO/进程启动失败：保留底层错误，打印时补充上下文。
    Io {
        context: String,
        source: std::io::Error,
    },
    /// 多个失败项的汇总（用于"逐项检查、最后一并报错"的场景）。
    Many(Vec<String>),
}

impl Error {
    pub fn msg(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }

    pub fn io(context: impl Into<String>, source: std::io::Error) -> Self {
        Self::Io {
            context: context.into(),
            source,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Message(m) => write!(f, "{m}"),
            Self::Io { context, source } => write!(f, "{context}: {source}"),
            Self::Many(items) => {
                writeln!(f, "有 {} 项失败：", items.len())?;
                for (i, item) in items.iter().enumerate() {
                    if i + 1 == items.len() {
                        write!(f, "  - {item}")?;
                    } else {
                        writeln!(f, "  - {item}")?;
                    }
                }
                Ok(())
            }
        }
    }
}

impl std::error::Error for Error {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

impl From<std::io::Error> for Error {
    fn from(source: std::io::Error) -> Self {
        Self::Io {
            context: "IO 失败".into(),
            source,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn many_lists_every_item() {
        let e = Error::Many(vec!["ssh 不可达".into(), "缺少 caddy".into()]);
        let text = e.to_string();
        assert!(text.contains("有 2 项失败"));
        assert!(text.contains("- ssh 不可达"));
        assert!(text.contains("- 缺少 caddy"));
    }

    #[test]
    fn io_error_keeps_context_and_source() {
        let io = std::io::Error::new(std::io::ErrorKind::NotFound, "没有这个文件");
        let e = Error::io("读取 .env.prod", io);
        assert_eq!(e.to_string(), "读取 .env.prod: 没有这个文件");
        assert!(std::error::Error::source(&e).is_some());
    }
}
