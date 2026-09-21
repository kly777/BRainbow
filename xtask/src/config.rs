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
use crate::ui;

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

    // ── 应用运行时（渲染 systemd unit 用）──
    pub service_port: u16,
    pub bind_host: String,
    pub database_url: String,
    /// 上传根目录（`UPLOAD_DIR`）：文件服务用其下的 `file/`、favicon 缓存用
    /// `favicons/`。默认 `uploads`（相对 WorkingDirectory，会落在 `service/` 里）；
    /// 生产应当指到 `data/` 下 —— 用户数据不该住在可整体替换的代码目录里。
    pub upload_dir: String,
    pub cors_allow_origin: String,
    /// 缺省 `false`（deploy.sh 用的也是这个默认值）。
    pub allow_register: String,
    /// 缺省 `864000`（10 天）。
    pub jwt_ttl_secs: String,

    // ── 远端路径（由 REMOTE_BASE / APP_NAME 派生）──
    pub remote_dir: String,
    pub service_dir: String,
    pub data_dir: String,
    pub backup_dir: String,
    /// 数据库文件名（不含目录）。
    pub database_file: String,
    /// 备份保留策略：先按天数，再按份数。
    pub backup_retain_days: u32,
    pub backup_retain_count: usize,

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
            .field("bind_host", &self.bind_host)
            .field("database_url", &self.database_url)
            .field("cors_allow_origin", &self.cors_allow_origin)
            .field("allow_register", &self.allow_register)
            .field("jwt_ttl_secs", &self.jwt_ttl_secs)
            .field("remote_dir", &self.remote_dir)
            .field("service_dir", &self.service_dir)
            .field("data_dir", &self.data_dir)
            .field("backup_dir", &self.backup_dir)
            .field("database_file", &self.database_file)
            .field("backup_retain_days", &self.backup_retain_days)
            .field("backup_retain_count", &self.backup_retain_count)
            .field("build_target", &self.build_target)
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
    ///
    /// **配置只来自 `.env.prod`（加约定派生），不读进程环境。** 这条是刻意的：
    /// `cargo xtask` 是 `cargo run`，而 `.cargo/config.toml` 的 `[env]` 会把
    /// `DATABASE_URL=sqlite:brainbow.db` 注进 xtask 进程 —— 读环境就等于让
    /// "开发机的构建配置"悄悄改掉"部署配置"（部署会把数据库指到开发库的相对路径，
    /// 而 `.env.prod` 里根本没写它）。任何在 shell 里 export 过的同名变量同理。
    /// 要覆盖某一项，就写进 `.env.prod`。
    fn from_vars(
        vars: BTreeMap<String, String>,
        env_file: PathBuf,
        project_dir: PathBuf,
    ) -> Result<Self> {
        let lookup = |key: &str| lookup(&vars, key);
        let missing = |key: &str| {
            Error::msg(format!(
                "缺少 {key}：请在 {} 里补上（模板见 .env.prod.example）",
                env_file.display()
            ))
        };
        let required = |key: &str| lookup(key).ok_or_else(|| missing(key));

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

        let remote_base = lookup("REMOTE_BASE").unwrap_or_else(|| "/opt".into());
        let remote_base = remote_base.trim_end_matches('/');
        let database_file = lookup("DATABASE_FILE").unwrap_or_else(|| "brainbow.db".into());
        let remote_dir = if remote_base.is_empty() {
            format!("/{app_name}")
        } else {
            format!("{remote_base}/{app_name}")
        };
        // 数据目录是"约定"的一部分：数据库与上传都在它下面。集中在这里算一次，
        // 好让下面的派生默认值都指向同一个地方（改根目录时不会漏掉某一项）。
        let data_dir = format!("{remote_dir}/data");

        Ok(Self {
            env_file,
            project_dir,
            remote_host,
            remote_user,
            remote_port,
            app_name,
            domain: lookup("DOMAIN").unwrap_or_else(|| "brainbow.top".into()),
            service_port,
            // 默认值与 deploy.sh 的 load_config 保持一致
            bind_host: lookup("BIND_HOST").unwrap_or_else(|| "0.0.0.0".into()),
            // 默认与后端一致（`src/shared/config.rs` 里 UPLOAD_DIR 缺省 `uploads`）
            // 上传根的默认值走**部署约定**（`data/uploads`），而不是后端的开发默认
            // （相对的 `uploads`）—— 后者会让数据落进 WorkingDirectory，
            // 也就是"随时可整体替换的" service/ 里。
            upload_dir: lookup("UPLOAD_DIR").unwrap_or_else(|| format!("{data_dir}/uploads")),
            cors_allow_origin: lookup("CORS_ALLOW_ORIGIN")
                .unwrap_or_else(|| "http://localhost:3000,http://localhost:5173".into()),
            allow_register: lookup("ALLOW_REGISTER").unwrap_or_else(|| "false".into()),
            jwt_ttl_secs: lookup("JWT_TTL_SECS").unwrap_or_else(|| "864000".into()),
            remote_dir: remote_dir.clone(),
            service_dir: format!("{remote_dir}/service"),
            data_dir,
            backup_dir: format!("{remote_dir}/backup"),
            database_url: lookup("DATABASE_URL")
                .unwrap_or_else(|| format!("sqlite:{remote_dir}/data/{database_file}")),
            database_file,
            backup_retain_days: number(&vars, "BACKUP_RETAIN_DAYS", 30)? as u32,
            backup_retain_count: number(&vars, "BACKUP_RETAIN_COUNT", 20)? as usize,
            build_target: lookup("BUILD_TARGET"),
            jwt_secret: lookup("JWT_SECRET"),
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

    /// 远端暂存目录。
    ///
    /// 放在 `$REMOTE_DIR` 下而不是 `$REMOTE_BASE`（即 `/opt`）下：后者是 root 的，
    /// ssh 用户建不了 —— deploy.sh 的回滚临时目录正是建在 `/opt/brb_rollback_$$`，
    /// 于是回滚必然失败（AGENTS.md 记的就是这一条）。
    pub fn remote_tmp_dir(&self) -> String {
        format!("{}/tmp", self.remote_dir)
    }

    /// 渲染 systemd unit 的路径。
    pub fn unit_path(&self) -> String {
        format!("/etc/systemd/system/{}.service", self.app_name)
    }

    /// 取 JWT_SECRET；`generate` 为真时缺失就现场生成并写回 `.env.prod`。
    ///
    /// 只有渲染 systemd unit 的路径会用到（unit 里含该密钥）。
    /// 把"写回配置文件"限制在这里，是为了不让 `just logs` 这种只读命令
    /// 悄悄改一个含密钥的文件 —— deploy.sh 是在 load_config 里无条件生成的，
    /// 于是每个子命令都可能动它（`make check` 都会）。
    pub fn require_jwt_secret(&mut self, generate: bool) -> Result<String> {
        if let Some(secret) = &self.jwt_secret {
            return Ok(secret.clone());
        }
        if !generate {
            return Err(Error::msg(format!(
                "缺少 JWT_SECRET：请在 {} 里补一行\n  JWT_SECRET=<openssl rand -hex 32 的输出>",
                self.env_file.display()
            )));
        }
        let secret = random_hex_32()?;
        append_secret(&self.env_file, &secret)?;
        ui::warn(&format!(
            "{} 里没有 JWT_SECRET：已生成并写回（重启后会话依然有效）",
            self.env_file.display()
        ));
        self.jwt_secret = Some(secret.clone());
        Ok(secret)
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
        let line = line
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(line);
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

/// 查找一个值：**只认文件**；空串视为未设置。
///
/// 刻意不回落读进程环境 —— 见 `from_vars` 的注释（cargo 的 `[env]` 会注入
/// `DATABASE_URL`，读了它部署就会指到开发库）。
fn lookup(vars: &BTreeMap<String, String>, key: &str) -> Option<String> {
    let non_empty = |s: String| {
        let trimmed = s.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    };
    vars.get(key).cloned().and_then(non_empty)
}

fn number(vars: &BTreeMap<String, String>, key: &str, default: u16) -> Result<u16> {
    match lookup(vars, key) {
        None => Ok(default),
        Some(raw) => raw.parse::<u16>().map_err(|_| {
            Error::msg(format!(
                "{key} 不是合法端口号：{raw:?}（应为 1-65535 的整数）"
            ))
        }),
    }
}

/// 32 字节随机数的十六进制表示，取代 `openssl rand -hex 32`（本机不再需要 openssl）。
fn random_hex_32() -> Result<String> {
    let mut buf = [0u8; 32];
    fill_random(&mut buf)?;
    Ok(hex::encode(buf))
}

/// 用操作系统熵源填随机字节。
///
/// 不引 `rand` 是为了让"部署工具"的依赖面保持最小：这里只需要一次
/// 不可预测的读，系统熵源就是最直接的来源。
#[cfg(unix)]
fn fill_random(buf: &mut [u8]) -> Result<()> {
    use std::io::Read;
    let mut file = std::fs::File::open("/dev/urandom")
        .map_err(|e| Error::io("打开 /dev/urandom（生成 JWT_SECRET）", e))?;
    file.read_exact(buf)
        .map_err(|e| Error::io("读取 /dev/urandom（生成 JWT_SECRET）", e))
}

#[cfg(windows)]
fn fill_random(buf: &mut [u8]) -> Result<()> {
    // Windows 没有 /dev/urandom。调用 advapi32 的 RtlGenRandom
    // （SystemFunction036）—— 它在所有受支持的 Windows 上都可用，
    // 且不需要额外的 crate。
    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn SystemFunction036(random_buffer: *mut u8, random_buffer_length: u32) -> u8;
    }
    // SAFETY: 传入的是本进程缓冲区及其真实长度，函数只往里写。
    let ok = unsafe { SystemFunction036(buf.as_mut_ptr(), buf.len() as u32) };
    if ok == 0 {
        return Err(Error::msg(
            "Windows 熵源 RtlGenRandom 调用失败（生成 JWT_SECRET）",
        ));
    }
    Ok(())
}

/// 把新生成的密钥追加到配置文件末尾（沿用 deploy.sh 的写回行为）。
fn append_secret(env_file: &Path, secret: &str) -> Result<()> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(env_file)
        .map_err(|e| Error::io(format!("追加 JWT_SECRET 到 {}", env_file.display()), e))?;
    writeln!(
        file,
        "\n# 部署时自动生成的 JWT 密钥（勿改，重启后会话保持有效）\nJWT_SECRET={secret}"
    )
    .map_err(|e| Error::io(format!("写入 {}", env_file.display()), e))?;
    Ok(())
}

#[cfg(test)]
impl Config {
    /// 测试用的配置：读**真实仓库根**，因此渲染测试用的是真实的
    /// `deploy/brainbow.service` / `deploy/Caddyfile` —— 模板与渲染代码
    /// 一旦脱节就能测出来。
    ///
    /// 配置不读进程环境（见 `from_vars` 的注释），所以断言不会随跑测试的环境变化。
    pub(crate) fn for_test() -> Self {
        let root = project_dir();
        let vars = [
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
            ("DOMAIN", "example.test"),
            ("BIND_HOST", "127.0.0.1"),
            ("CORS_ALLOW_ORIGIN", "https://example.test"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        Self::from_vars(vars, root.join(".env.prod"), root).expect("测试配置应当成立")
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
        assert_eq!(
            parsed.get("DOMAIN").map(String::as_str),
            Some("brainbow.top")
        );
        assert_eq!(parsed.get("SERVICE_PORT").map(String::as_str), Some("8080"));
        assert_eq!(
            parsed.get("BIND_HOST").map(String::as_str),
            Some("127.0.0.1")
        );
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
        // 暂存目录在 $REMOTE_DIR 下（不是 /opt —— 那里 ssh 用户写不了）
        assert_eq!(cfg.remote_tmp_dir(), "/opt/brb/tmp");
        assert_eq!(cfg.unit_path(), "/etc/systemd/system/brb.service");
        // DATABASE_URL 没写时按远端数据目录推出来（deploy.sh 同样这么补）
        assert_eq!(cfg.database_url, "sqlite:/opt/brb/data/brainbow.db");
        // 上传根也按部署约定推出来：**不是**后端那个相对的开发默认 `uploads`
        // （那会让数据落进 WorkingDirectory = service/）。
        // 这几个值与后端从 `BRAINBOW_ROOT=/opt/brb` 推出来的完全一致
        // （见 src/shared/config.rs 的 root_dir_derives_the_data_paths）——
        // 两边的约定必须同步改，改一处漏另一处就会把数据放到别的地方。
        assert_eq!(cfg.upload_dir, "/opt/brb/data/uploads");
        // 默认值与 deploy.sh 一致
        assert_eq!(cfg.remote_port, 22);
        assert_eq!(cfg.service_port, 8080);
        assert_eq!(cfg.domain, "brainbow.top");
        assert_eq!(cfg.bind_host, "0.0.0.0");
        assert_eq!(cfg.allow_register, "false");
        assert_eq!(cfg.jwt_ttl_secs, "864000");
        assert_eq!(cfg.backup_retain_days, 30);
        assert_eq!(cfg.backup_retain_count, 20);
        assert!(cfg.cross_target().is_none(), "默认应当是本机编译");
    }

    #[test]
    fn honors_explicit_runtime_values() {
        let cfg = build(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
            ("BIND_HOST", "127.0.0.1"),
            ("DATABASE_URL", "sqlite:/data/x.db"),
            ("CORS_ALLOW_ORIGIN", "https://a.top"),
            ("ALLOW_REGISTER", "true"),
            ("JWT_TTL_SECS", "60"),
            ("BUILD_TARGET", "x86_64-unknown-linux-gnu"),
        ])
        .expect("配置应当成立");
        assert_eq!(cfg.bind_host, "127.0.0.1");
        assert_eq!(cfg.database_url, "sqlite:/data/x.db");
        assert_eq!(cfg.allow_register, "true");
        assert_eq!(cfg.cross_target(), Some("x86_64-unknown-linux-gnu"));
    }

    #[test]
    fn native_build_target_is_not_cross_compilation() {
        for value in ["native", ""] {
            let cfg = build(&[
                ("REMOTE_HOST", "203.0.113.7"),
                ("REMOTE_USER", "kly"),
                ("APP_NAME", "brb"),
                ("BUILD_TARGET", value),
            ])
            .expect("配置应当成立");
            assert!(
                cfg.cross_target().is_none(),
                "BUILD_TARGET={value:?} 应视作本机"
            );
        }
    }

    #[test]
    fn jwt_secret_error_points_at_the_file() {
        let mut cfg = build(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
        ])
        .expect("配置应当成立");
        let err = cfg
            .require_jwt_secret(false)
            .expect_err("缺失且不允许生成时应当报错");
        let text = err.to_string();
        assert!(text.contains("/repo/.env.prod"), "{text}");
        assert!(text.contains("openssl rand -hex 32"), "{text}");
    }

    #[test]
    fn existing_jwt_secret_is_returned_unchanged() {
        let mut cfg = build(&[
            ("REMOTE_HOST", "203.0.113.7"),
            ("REMOTE_USER", "kly"),
            ("APP_NAME", "brb"),
            ("JWT_SECRET", "deadbeef"),
        ])
        .expect("配置应当成立");
        assert_eq!(cfg.require_jwt_secret(false).expect("应当取到"), "deadbeef");
    }

    #[test]
    fn random_hex_32_is_64_hex_chars_and_unique() {
        let a = random_hex_32().expect("熵源可用");
        let b = random_hex_32().expect("熵源可用");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b, "两次生成不应当相同");
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
    fn file_wins_and_missing_keys_fall_back_to_deploy_conventions() {
        // 文件里写了就用文件里的值（不再有"进程环境兜底"这一层）
        let mut pairs = minimal().into_iter().collect::<Vec<_>>();
        pairs.push(("SERVICE_PORT".into(), "9090".into()));
        let cfg = Config::from_vars(
            pairs.into_iter().collect(),
            PathBuf::from("/repo/.env.prod"),
            PathBuf::from("/repo"),
        )
        .expect("配置应当成立");
        assert_eq!(cfg.service_port, 9090);

        // 没写的走约定/默认值 —— 而不是"碰巧在环境里"的东西
        let cfg = Config::from_vars(
            minimal(),
            PathBuf::from("/repo/.env.prod"),
            PathBuf::from("/repo"),
        )
        .expect("配置应当成立");
        assert_eq!(cfg.service_port, 8080, "没写就用默认端口");
        assert_eq!(cfg.database_url, "sqlite:/opt/brb/data/brainbow.db");
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
