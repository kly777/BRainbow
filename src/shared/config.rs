//! 集中配置管理。
//!
//! 从环境变量加载应用配置，提供类型安全的访问方式。
//! 消除 `main.rs` 和各模块中散落的 `std::env::var()` 调用。

use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;

/// 应用配置
#[derive(Debug, Clone)]
pub struct Config {
    /// 数据库 URL（默认 `sqlite:brainbow.db`）
    pub database_url: String,

    /// JWT 密钥（默认随机生成）
    pub jwt_secret: String,

    /// 允许的 CORS 来源（逗号分隔）
    pub cors_allow_origin: Vec<String>,

    /// 服务监听端口
    pub service_port: u16,

    /// 绑定地址
    pub bind_host: IpAddr,

    /// 是否开放注册（默认关闭；公网部署建议保持关闭）
    pub allow_register: bool,

    /// JWT 有效期（秒），默认 10 天
    pub jwt_ttl_secs: i64,

    /// 上传根目录（默认 `uploads`）；文件服务用其下的 `file` 子目录，见 [`Config::file_upload_dir`]
    pub upload_dir: PathBuf,

    /// ffmpeg 可执行文件（来自 `FFMPEG_PATH`，可空）。
    /// 实际用哪个路径由 [`resolve_ffmpeg`] 决定（还会看应用自带的 `bin/ffmpeg`）。
    /// 它只用于"给视频出海报帧"，缺了就永久降级为后缀徽章，不影响其他功能。
    pub ffmpeg_path: Option<PathBuf>,

    /// 备份目录（`BACKUP_DIR`，默认按根目录约定取 `{root}/backup`），可空。
    ///
    /// 备份是**部署工具**写的（xtask 的 `backup_dir`），应用只读它来报"备份有多少份、
    /// 占多大"（/admin 的服务器信息）。开发环境没有这个概念，所以是 `Option`：
    /// 没有就报"未配置"，不要编一个路径出来。
    pub backup_dir: Option<PathBuf>,
}

impl Config {
    /// 从环境变量加载配置。
    ///
    /// 缺失的配置使用安全默认值，不会 panic。
    /// `JWT_SECRET` 若未设置则自动生成随机值（启动时会打日志说明）。
    pub fn from_env() -> Self {
        Self::from_vars(|key| std::env::var(key))
    }

    /// 文件服务的上传目录（上传根目录下的 `file` 子目录）。
    ///
    /// 上传写入与下载读取都从这里派生，避免调用点各自拼 `{dir}/file` 导致读写路径不一致
    /// （历史上 handler 硬编码 `uploads/file`，改了 `UPLOAD_DIR` 就变成"上传成功、下载全 404"）。
    pub fn file_upload_dir(&self) -> String {
        format!("{}/file", self.upload_dir.display())
    }

    /// ffmpeg 的实际路径：显式配置 > 应用自带的 `bin/ffmpeg` > PATH 里的 `ffmpeg`。
    ///
    /// 自带的那份优先于 PATH，是为了让"随部署产物走的静态二进制"真的被用到 ——
    /// 远端 PATH 上恰好有另一个版本时，行为不该随发行版漂移。
    pub fn exec_ffmpeg(&self) -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));
        resolve_ffmpeg(self.ffmpeg_path.as_deref(), exe_dir.as_deref())
    }

    /// 从注入的变量读取器加载配置（测试用，避免全局 env 竞态）。
    fn from_vars(vars: impl Fn(&str) -> Result<String, std::env::VarError>) -> Self {
        let jwt_secret = vars("JWT_SECRET").unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

        if vars("JWT_SECRET").is_err() {
            tracing::info!("JWT_SECRET 未设置，使用随机密钥（重启后现有 token 将失效）");
        }

        // ── 路径按三层级联决定：显式单项 > 根目录约定 > 开发默认 ──
        //
        // 根目录（`BRAINBOW_ROOT`）是部署时唯一需要指定的东西，其余按约定派生：
        // `{root}/data/<DATABASE_FILE>` 与 `{root}/data/uploads`。
        // 单独指定 `DATABASE_URL` / `UPLOAD_DIR` 仍然优先 —— 逃生口一直在。
        //
        // 为什么要有根：否则"数据在哪"这件事要在 unit、.env.prod、以及任何手动
        // 跑一次的命令行里各写一遍，改根目录时漏掉一处就会把数据写到别的地方，
        // 而且这种错是静默的（服务照跑，文件不见了）。
        let root = vars("BRAINBOW_ROOT").ok().map(PathBuf::from);
        let db_file = vars("DATABASE_FILE").unwrap_or_else(|_| "brainbow.db".into());
        let under_root = |suffix: &str| root.as_ref().map(|r| r.join(suffix));

        Self {
            database_url: vars("DATABASE_URL").unwrap_or_else(|_| {
                under_root(&format!("data/{db_file}"))
                    .map(|p| format!("sqlite:{}", p.display()))
                    .unwrap_or_else(|| "sqlite:brainbow.db".into())
            }),

            jwt_secret,

            cors_allow_origin: vars("CORS_ALLOW_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),

            service_port: vars("SERVICE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),

            bind_host: vars("BIND_HOST")
                .ok()
                .and_then(|h| h.parse().ok())
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),

            allow_register: vars("ALLOW_REGISTER")
                .ok()
                .and_then(|v| match v.trim().to_lowercase().as_str() {
                    "1" | "true" | "yes" | "on" => Some(true),
                    _ => None,
                })
                .unwrap_or(false),

            jwt_ttl_secs: vars("JWT_TTL_SECS")
                .ok()
                .and_then(|p| p.parse().ok())
                .filter(|v| *v > 0)
                .unwrap_or(864000),

            upload_dir: vars("UPLOAD_DIR")
                .map(PathBuf::from)
                .ok()
                .or_else(|| under_root("data/uploads"))
                .unwrap_or_else(|| PathBuf::from("uploads")),

            ffmpeg_path: vars("FFMPEG_PATH").ok().map(PathBuf::from),

            // 备份目录与数据/上传同一套级联（显式 > 根目录约定），但没有开发默认：
            // 开发机上没人为你建备份，编一个 `backup` 只会指向一个不存在的地方。
            backup_dir: vars("BACKUP_DIR")
                .map(PathBuf::from)
                .ok()
                .or_else(|| under_root("backup")),
        }
    }
}

/// 决定 ffmpeg 用哪个可执行文件（纯函数，便于直测）。
///
/// 顺序：显式配置（`FFMPEG_PATH`）> 应用同目录下的 `bin/ffmpeg` > 交给 PATH 解析的裸名。
/// 自带的那份优先于 PATH：部署时把静态二进制随产物放在 `bin/`，就不该因为远端
/// PATH 上恰好有另一个 ffmpeg 而换用那个（版本随发行版漂移是这类工具的经典部署陷阱）。
pub fn resolve_ffmpeg(
    explicit: Option<&std::path::Path>,
    exe_dir: Option<&std::path::Path>,
) -> PathBuf {
    if let Some(path) = explicit {
        return path.to_path_buf();
    }
    if let Some(dir) = exe_dir {
        let bundled = dir.join("bin").join("ffmpeg");
        if bundled.is_file() {
            return bundled;
        }
    }
    PathBuf::from("ffmpeg")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    /// 注入式变量读取器：测试不触碰全局 env，可并行运行
    fn vars_with<'a>(
        overrides: &'a [(&'a str, &'a str)],
    ) -> impl Fn(&str) -> Result<String, std::env::VarError> + 'a {
        move |key| {
            overrides
                .iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| v.to_string())
                .ok_or(std::env::VarError::NotPresent)
        }
    }

    #[test]
    fn config_parses_cors() {
        let vars = vars_with(&[("CORS_ALLOW_ORIGIN", "http://a.com, http://b.com")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.cors_allow_origin, vec!["http://a.com", "http://b.com"]);
    }

    #[test]
    fn config_parses_port() {
        let vars = vars_with(&[("SERVICE_PORT", "8080")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.service_port, 8080);
    }

    #[test]
    fn config_invalid_port_falls_back() {
        let vars = vars_with(&[("SERVICE_PORT", "not-a-number")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.service_port, 3000);
    }

    #[test]
    fn config_missing_vars_use_defaults() {
        let cfg = Config::from_vars(vars_with(&[]));
        assert_eq!(cfg.database_url, "sqlite:brainbow.db");
        assert_eq!(cfg.service_port, 3000);
        assert_eq!(cfg.cors_allow_origin, vec!["http://localhost:3000"]);
        assert_eq!(cfg.upload_dir, PathBuf::from("uploads"));
        assert_eq!(cfg.file_upload_dir(), "uploads/file");
        assert!(cfg.jwt_secret.len() >= 36); // 随机 UUID
    }

    #[test]
    fn file_upload_dir_follows_configured_root() {
        let vars = vars_with(&[("UPLOAD_DIR", "/data/brainbow-uploads")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.file_upload_dir(), "/data/brainbow-uploads/file");
    }

    // ── 路径级联：显式单项 > 根目录约定 > 开发默认 ──

    #[test]
    fn root_dir_derives_the_data_paths() {
        // 部署时只需要给一个根：数据一律落在 `{root}/data/` 下
        let cfg = Config::from_vars(vars_with(&[("BRAINBOW_ROOT", "/opt/brb")]));
        assert_eq!(cfg.database_url, "sqlite:/opt/brb/data/brainbow.db");
        assert_eq!(cfg.upload_dir, PathBuf::from("/opt/brb/data/uploads"));
        assert_eq!(cfg.file_upload_dir(), "/opt/brb/data/uploads/file");
        // 备份在 `{root}/backup`（部署工具往那儿写，应用只读来报大小）
        assert_eq!(cfg.backup_dir, Some(PathBuf::from("/opt/brb/backup")));
    }

    #[test]
    fn backup_dir_has_no_dev_default() {
        // 开发机上没有备份目录：宁可是 None（前端显示"未配置"），
        // 也不要编一个相对路径出来 —— 那会让人以为备份真的在那儿
        let cfg = Config::from_vars(vars_with(&[]));
        assert_eq!(cfg.backup_dir, None);
    }

    #[test]
    fn explicit_backup_dir_wins() {
        let vars = vars_with(&[
            ("BRAINBOW_ROOT", "/opt/brb"),
            ("BACKUP_DIR", "/mnt/offsite/backup"),
        ]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.backup_dir, Some(PathBuf::from("/mnt/offsite/backup")));
    }

    #[test]
    fn root_dir_honors_database_file_name() {
        // 文件名与部署工具共用同一个变量（改一处两边都跟着走）
        let vars = vars_with(&[("BRAINBOW_ROOT", "/opt/brb"), ("DATABASE_FILE", "prod.db")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.database_url, "sqlite:/opt/brb/data/prod.db");
    }

    #[test]
    fn explicit_paths_win_over_the_root() {
        // 逃生口：单项显式配置永远优先，根目录只是默认值的来源
        let vars = vars_with(&[
            ("BRAINBOW_ROOT", "/opt/brb"),
            ("DATABASE_URL", "sqlite:/elsewhere/x.db"),
            ("UPLOAD_DIR", "/mnt/big/uploads"),
        ]);
        let cfg = Config::from_vars(vars);
        assert_eq!(cfg.database_url, "sqlite:/elsewhere/x.db");
        assert_eq!(cfg.upload_dir, PathBuf::from("/mnt/big/uploads"));
    }

    #[test]
    fn root_dir_does_not_leak_into_other_paths() {
        // 根目录只管数据位置：没配的项仍然是各自的默认值
        let cfg = Config::from_vars(vars_with(&[("BRAINBOW_ROOT", "/opt/brb")]));
        assert_eq!(cfg.service_port, 3000);
        assert!(cfg.ffmpeg_path.is_none(), "ffmpeg 仍走自发现");
    }

    // ── ffmpeg 路径解析 ──
    //
    // 顺序：显式配置 > 应用自带 bin/ffmpeg > PATH。自带的那份优先于 PATH，
    // 是为了让"随部署产物走的静态二进制"真的被用到。

    #[test]
    fn ffmpeg_env_wins_over_everything() {
        let explicit = PathBuf::from("/opt/ffmpeg-7.0/ffmpeg");
        let exe_dir = std::env::temp_dir().join("brainbow-cfg-exe");
        std::fs::create_dir_all(exe_dir.join("bin")).unwrap();
        std::fs::write(exe_dir.join("bin").join("ffmpeg"), b"#!/bin/sh\n").unwrap();

        assert_eq!(
            resolve_ffmpeg(Some(&explicit), Some(&exe_dir)),
            explicit,
            "FFMPEG_PATH 明确指定时不该被别的路径抢走"
        );
        let _ = std::fs::remove_dir_all(&exe_dir);
    }

    #[test]
    fn bundled_binary_beats_path_lookup() {
        let exe_dir = std::env::temp_dir().join(format!("brainbow-cfg-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(exe_dir.join("bin")).unwrap();
        let bundled = exe_dir.join("bin").join("ffmpeg");
        std::fs::write(&bundled, b"#!/bin/sh\n").unwrap();

        assert_eq!(resolve_ffmpeg(None, Some(&exe_dir)), bundled);

        let _ = std::fs::remove_dir_all(&exe_dir);
    }

    #[test]
    fn falls_back_to_path_when_nothing_is_bundled() {
        let exe_dir = std::env::temp_dir().join(format!("brainbow-cfg-{}", nanoid::nanoid!(8)));
        std::fs::create_dir_all(&exe_dir).unwrap();

        assert_eq!(
            resolve_ffmpeg(None, Some(&exe_dir)),
            PathBuf::from("ffmpeg")
        );
        // 连可执行文件目录都拿不到时同样退回裸名（靠 PATH）
        assert_eq!(resolve_ffmpeg(None, None), PathBuf::from("ffmpeg"));

        let _ = std::fs::remove_dir_all(&exe_dir);
    }

    #[test]
    fn config_reads_ffmpeg_path() {
        let vars = vars_with(&[("FFMPEG_PATH", "/usr/local/bin/ffmpeg")]);
        let cfg = Config::from_vars(vars);
        assert_eq!(
            cfg.ffmpeg_path,
            Some(PathBuf::from("/usr/local/bin/ffmpeg"))
        );

        let cfg = Config::from_vars(vars_with(&[]));
        assert_eq!(cfg.ffmpeg_path, None, "未设置时留给 resolve_ffmpeg 兜底");
    }
}
