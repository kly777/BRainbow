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

    /// 记忆系统配置路径
    pub mem_config_path: PathBuf,

    /// 上传目录（预留，当前使用 `uploads` 硬编码）
    #[allow(dead_code)]
    pub upload_dir: PathBuf,
}

impl Config {
    /// 从环境变量加载配置。
    ///
    /// 缺失的配置使用安全默认值，不会 panic。
    /// `JWT_SECRET` 若未设置则自动生成随机值（启动时会打日志说明）。
    pub fn from_env() -> Self {
        let jwt_secret =
            std::env::var("JWT_SECRET").unwrap_or_else(|_| uuid::Uuid::new_v4().to_string());

        if std::env::var("JWT_SECRET").is_err() {
            tracing::info!("JWT_SECRET 未设置，使用随机密钥（重启后现有 token 将失效）");
        }

        Self {
            database_url: std::env::var("DATABASE_URL")
                .unwrap_or_else(|_| "sqlite:brainbow.db".into()),

            jwt_secret,

            cors_allow_origin: std::env::var("CORS_ALLOW_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:3000".into())
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),

            service_port: std::env::var("SERVICE_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(3000),

            bind_host: std::env::var("BIND_HOST")
                .ok()
                .and_then(|h| h.parse().ok())
                .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED)),

            mem_config_path: PathBuf::from("mem_config.json"),

            upload_dir: PathBuf::from("uploads"),
        }
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;

    #[test]
    fn config_parses_cors() {
        // SAFETY: 测试环境中的 env var 操作
        unsafe { std::env::set_var("CORS_ALLOW_ORIGIN", "http://a.com, http://b.com") };
        let cfg = Config::from_env();
        assert_eq!(cfg.cors_allow_origin, vec!["http://a.com", "http://b.com"]);
        unsafe { std::env::remove_var("CORS_ALLOW_ORIGIN") };
    }

    #[test]
    fn config_parses_port() {
        unsafe { std::env::set_var("SERVICE_PORT", "8080") };
        let cfg = Config::from_env();
        assert_eq!(cfg.service_port, 8080);
        unsafe { std::env::remove_var("SERVICE_PORT") };
    }

    #[test]
    fn config_invalid_port_falls_back() {
        unsafe { std::env::set_var("SERVICE_PORT", "not-a-number") };
        let cfg = Config::from_env();
        assert_eq!(cfg.service_port, 3000);
        unsafe { std::env::remove_var("SERVICE_PORT") };
    }
}
