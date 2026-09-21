//! `.env.prod` 解析与派生路径。
//!
//! 取代 deploy.sh 的 `set -o allexport; source "$env_file"`：文件不再被 shell 求值，
//! 所以值里出现空格 / `&` / `|` / 引号都不会破坏任何东西。
//! （`source` 那条路上值必须写成 shell 安全的形式，而同一批值又要过
//! `sed -e "s|@@X@@|$X|g"` 渲染模板 —— 值里带 `|` 或 `&` 会静默改坏 unit/Caddyfile。）
//!
//! 取值优先级与 `source` 保持一致：**文件里定义了的键，文件说了算**；
//! 文件没定义的键回落到进程环境（对应 `WITH_FFPROBE=1 make deploy` 那种用法）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

/// `.env.prod.example` 里的占位值：填了这个等于没填（deploy.sh 同样判它未设置）。
const PLACEHOLDER_HOST: &str = "your-server-ip-or-domain.com";

pub struct Config {
    /// 实际读的配置文件（报错信息里要指路）。
    pub env_file: PathBuf,
    /// 仓库根目录。
    pub project_dir: PathBuf,

    // ── 部署目标 ──
    pub remote_host: String,
    pub remote_user: String,
    pub remote_port: u16,
    pub app_name: String,
    /// Caddy 站点域名。
    pub domain: String,

    // ── 应用运行时 ──
    pub service_port: u16,

    // ── 远端路径（由 REMOTE_BASE / APP_NAME 派生）──
    pub service_dir: String,
    pub data_dir: String,
    pub backup_dir: String,
    /// 数据库文件名（不含目录）。
    pub database_file: String,

    /// `BUILD_TARGET`：留空或 `native` 表示本机编译。
    pub build_target: Option<String>,

    /// 缺失时为 `None`。
    ///
    /// 只读命令不该因为一个跟它无关的密钥而失败，所以这里不校验；
    /// 需要它的只有渲染 systemd unit 的构建/部署路径（后续阶段接）。
    pub jwt_secret: Option<String>,
}

impl std::fmt::Debug for Config {
    /// 手写而**不是**派生：`jwt_secret` 是密钥，不能因为某次 panic 或日志
    /// 就把它打出来。unit 文件之所以要 chmod 600，也是同一个理由。
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Config")
            .field("env_file", &self.env_file)
            .field("project_dir", &self.project_dir)
            .field("remote_host", &self.remote_host)
            .field("remote_user", &self.remote_user)
            .field("remote_port", &self.remote_port)
            .field("app_name", &self.app_name)
            .field("domain", &self.domain)
            .field("service_port", &self.service_port)
            .field("service_dir", &self.service_dir)
            .field("data_dir", &self.data_dir)
            .field("backup_dir", &self.backup_dir)
            .field("database_file", &self.database_file)
            .field("jwt_secret", &self.jwt_secret.as_ref().map(|_| "<已设置>"))
            .finish()
    }
}

impl Config {
    /// 读取 `.env.prod`（或 `--env-file` 指定的文件）。
    pub fn load(env_file: Option<&Path>) -> Result<Self> {
        let project_dir = project_dir();
        let env_file = match env_file {
            Some(p) => p.to_path_buf(),
            None => project_dir.join(".env.prod"),
        };
        let text = std::fs::read_to_string(&env_file).map_err(|e| {
            Error::io(
                format!(
                    "读取 {}（模板见 .env.prod.example，复制一份改名即可）",
                    env_file.display()
                ),
                e,
            )
        })?;
        Self::from_vars(parse_env(&text), env_file, project_dir)
    }

    /// 纯函数部分，便于单测。
    fn from_vars(
        vars: BTreeMap<String, String>,
        env_file: PathBuf,
        project_dir: PathBuf,
    ) -> Result<Self> {
        let missing = |key: &str| {
            Error::msg(format!(
                "缺少 {key}：请在 {} 里补上（模板见 .env.prod.example）",
                env_file.display()
            ))
        };
        let required = |key: &str| lookup(&vars, key).ok_or_else(|| missing(key));

        let remote_host = required("REMOTE_HOST")?;
        if remote_host == PLACEHOLDER_HOST {
            return Err(Error::msg(format!(
                "{} 里的 REMOTE_HOST 还是模板占位值（{PLACEHOLDER_HOST}），请填真实主机",
                env_file.display()
            )));
        }
        let remote_user = required("REMOTE_USER")?;
        let app_name = required("APP_NAME")?;

        let remote_port = number(&vars, "REMOTE_PORT", 22)?;
        let service_port = number(&vars, "SERVICE_PORT", 8080)?;

        let remote_base = lookup(&vars, "REMOTE_BASE").unwrap_or_else(|| "/opt".into());
        let remote_base = remote_base.trim_end_matches('/');
        let remote_dir = if remote_base.is_empty() {
            format!("/{app_name}")
        } else {
            format!("{remote_base}/{app_name}")
        };

        Ok(Self {
            env_file,
            project_dir,
            remote_host,
            remote_user,
            remote_port,
            app_name,
            domain: lookup(&vars, "DOMAIN").unwrap_or_else(|| "brainbow.top".into()),
            service_port,
            service_dir: format!("{remote_dir}/service"),
            data_dir: format!("{remote_dir}/data"),
            backup_dir: format!("{remote_dir}/backup"),
            database_file: lookup(&vars, "DATABASE_FILE").unwrap_or_else(|| "brainbow.db".into()),
            build_target: lookup(&vars, "BUILD_TARGET"),
            jwt_secret: lookup(&vars, "JWT_SECRET"),
        })
    }

    /// 交叉编译目标：`BUILD_TARGET` 非空且不是 `native` 时才算数。
    ///
    /// 注意这里只是把 `--target` 传给 cargo —— 真要产出可执行的二进制，
    /// 还需要目标平台的链接器（`rustup target add <triple>` + 交叉工具链），
    /// cargo 不代劳，缺了会在链接阶段报错。
    pub fn cross_target(&self) -> Option<&str> {
        match self.build_target.as_deref() {
            Some(target) if !target.is_empty() && target != "native" => Some(target),
            _ => None,
        }
    }

    /// `user@host`，ssh/scp 的目标。
    pub fn target(&self) -> String {
        format!("{}@{}", self.remote_user, self.remote_host)
    }

    /// 远端数据库绝对路径。
    pub fn database_path(&self) -> String {
        format!("{}/{}", self.data_dir, self.database_file)
    }

    /// 本地产物目录 `build/`。
    pub fn build_dir(&self) -> PathBuf {
        self.project_dir.join("build")
    }

    /// 前端目录 `web/`（vite 的产物在 `web/dist`）。
    pub fn web_dir(&self) -> PathBuf {
        self.project_dir.join("web")
    }
}

/// 仓库根目录：以编译期记录的 xtask 自身位置为准，而不是当前目录 ——
/// 从 `web/` 或任何别处调用都不会算错。
fn project_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf()
}

/// 解析 `KEY=VALUE` 行。忽略空行与 `#` 注释；容忍 `export ` 前缀与成对引号。
///
/// 刻意**不**剥离行内注释：`source` 也不会（未加引号的值里 `#` 之后的内容
/// 在 bash 里同样属于值的一部分，除非前面有空白）。保持一致比"更聪明"重要。
pub fn parse_env(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").map(str::trim_start).unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty() {
            continue;
        }
        out.insert(key.to_string(), unquote(value.trim()).to_string());
    }
    out
}

/// 去掉成对的单/双引号（`.env` 惯例）。
fn unquote(value: &str) -> &str {
    let bytes = value.as_bytes();
    if bytes.len() >= 2 {
        let first = bytes[0];
        if (first == b'"' || first == b'\'') && bytes[bytes.len() - 1] == first {
            return &value[1..value.len() - 1];
        }
    }
    value
}

/// 查找一个值：文件优先，进程环境兜底；空串视为未设置。
fn lookup(vars: &BTreeMap<String, String>, key: &str) -> Option<String> {
    let non_empty = |s: String| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() { None } else { Some(trimmed) }
    };
    vars.get(key)
        .cloned()
        .and_then(non_empty)
        .or_else(|| std::env::var(key).ok().and_then(non_empty))
}

fn number(vars: &BTreeMap<String, String>, key: &str, default: u16) -> Result<u16> {
    match lookup(vars, key) {
        None => Ok(default),
        Some(raw) => raw.parse::<u16>().map_err(|_| {
            Error::msg(format!("{key} 不是合法端口号：{raw:?}（应为 1-65535 的整数）"))
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect()
    }

    fn minimal() -> BTreeMap<String, String> {
        vars(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
        ])
    }

    fn build(pairs: &[(&str, &str)]) -> Result<Config> {
        Config::from_vars(
            vars(pairs),
            PathBuf::from("/repo/.env.prod"),
            PathBuf::from("/repo"),
        )
    }

    #[test]
    fn parses_comments_quotes_and_export() {
        let parsed = parse_env(
            "# 注释\r\n\
             \n\
             DOMAIN=\"brainbow.top\"\n\
             SERVICE_PORT=8080\n\
             export BIND_HOST='127.0.0.1'\n\
             CORS_ALLOW_ORIGIN=https://a.top,http://a.top\n\
             这行没有等号\n\
             =缺键名\n",
        );
        assert_eq!(parsed.get("DOMAIN").map(String::as_str), Some("brainbow.top"));
        assert_eq!(parsed.get("SERVICE_PORT").map(String::as_str), Some("8080"));
        assert_eq!(parsed.get("BIND_HOST").map(String::as_str), Some("127.0.0.1"));
        assert_eq!(parsed.len(), 4);
    }

    #[test]
    fn keeps_shell_metacharacters_intact() {
        // 这几个字符正是 sed "s|@@X@@|$X|g" 渲染会咬坏的东西。
        let parsed = parse_env("CORS_ALLOW_ORIGIN=https://a.top?a=1&b=2|c\nNAME=含 空格 的值\n");
        assert_eq!(
            parsed.get("CORS_ALLOW_ORIGIN").map(String::as_str),
            Some("https://a.top?a=1&b=2|c")
        );
        assert_eq!(parsed.get("NAME").map(String::as_str), Some("含 空格 的值"));
    }

    #[test]
    fn derives_remote_paths() {
        let cfg = build(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
        ])
        .expect("最小配置应当成立");
        assert_eq!(cfg.service_dir, "/opt/brb/service");
        assert_eq!(cfg.data_dir, "/opt/brb/data");
        assert_eq!(cfg.backup_dir, "/opt/brb/backup");
        assert_eq!(cfg.database_path(), "/opt/brb/data/brainbow.db");
        assert_eq!(cfg.target(), "kly@203.0.113.7");
        // 默认值与 deploy.sh 一致
        assert_eq!(cfg.remote_port, 22);
        assert_eq!(cfg.service_port, 8080);
        assert_eq!(cfg.domain, "brainbow.top");
    }

    #[test]
    fn honors_remote_base_and_app_name() {
        let cfg = build(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brainbow"),
            ("REMOTE_BASE", "/srv/"),
            ("DATABASE_FILE", "prod.db"),
        ])
        .expect("配置应当成立");
        assert_eq!(cfg.service_dir, "/srv/brainbow/service");
        assert_eq!(cfg.database_path(), "/srv/brainbow/data/prod.db");
    }

    #[test]
    fn rejects_missing_and_placeholder_required_vars() {
        let err = build(&[("REMOTE_USER", "kly"), ("APP_NAME", "brb")])
            .expect_err("缺 REMOTE_HOST 应当报错");
        assert!(err.to_string().contains("缺少 REMOTE_HOST"), "{err}");

        let err = build(&[
            ("REMOTE_HOST", PLACEHOLDER_HOST),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
        ])
        .expect_err("模板占位值应当报错");
        assert!(err.to_string().contains("模板占位值"), "{err}");
    }

    #[test]
    fn rejects_bad_port() {
        let mut pairs = minimal().into_iter().collect::<Vec<_>>();
        pairs.push(("SERVICE_PORT".into(), "8080x".into()));
        let err = Config::from_vars(
            pairs.into_iter().collect(),
            PathBuf::from("/repo/.env.prod"),
            PathBuf::from("/repo"),
        )
        .expect_err("非法端口应当报错");
        assert!(err.to_string().contains("不是合法端口号"), "{err}");
    }

    #[test]
    fn empty_value_counts_as_unset() {
        // JWT_SECRET= （空）应与"没写"等价，否则会渲染出一个空密钥的 unit。
        let mut pairs = minimal().into_iter().collect::<Vec<_>>();
        pairs.push(("JWT_SECRET".into(), "   ".into()));
        let cfg = Config::from_vars(
            pairs.into_iter().collect(),
            PathBuf::from("/repo/.env.prod"),
            PathBuf::from("/repo"),
        )
        .expect("配置应当成立");
        assert!(cfg.jwt_secret.is_none());
    }
}
