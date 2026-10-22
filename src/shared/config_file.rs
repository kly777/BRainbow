//! 应用 TOML 配置读取。
//!
//! 只负责把 app.toml / secret.toml 展开成 Config::from_vars 认识的键；
//! 路径级联、默认值与校验仍集中在 `config.rs`。

use std::collections::BTreeMap;
use std::error::Error;
use std::path::Path;

use serde::Deserialize;

const VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppFile {
    version: u32,
    #[serde(default)]
    server: Server,
    #[serde(default)]
    security: Security,
    #[serde(default)]
    site: Site,
    #[serde(default)]
    cors: Cors,
    #[serde(default)]
    database: Database,
    #[serde(default)]
    uploads: Uploads,
    #[serde(default)]
    backup: Backup,
    #[serde(default)]
    ffmpeg: Ffmpeg,
    #[serde(default)]
    frontend: Frontend,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Server {
    #[serde(default = "default_port")]
    port: u16,
    #[serde(default = "default_bind")]
    bind: String,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Security {
    #[serde(default)]
    allow_register: bool,
    #[serde(default = "default_ttl")]
    jwt_ttl_secs: i64,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Site {
    #[serde(default, rename = "url")]
    _url: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Cors {
    #[serde(default)]
    allow_origins: Vec<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Database {
    #[serde(default)]
    file: Option<String>,
    #[serde(default)]
    url: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Uploads {
    #[serde(default)]
    dir: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Backup {
    #[serde(default)]
    dir: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Ffmpeg {
    #[serde(default)]
    path: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Frontend {
    #[serde(default, rename = "port")]
    _port: Option<u16>,
    #[serde(default, rename = "api_target")]
    _api_target: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretFile {
    version: u32,
    #[serde(default)]
    jwt: JwtSecret,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct JwtSecret {
    #[serde(default)]
    secret: Option<String>,
}

fn default_port() -> u16 {
    3000
}
fn default_bind() -> String {
    "127.0.0.1".into()
}
fn default_ttl() -> i64 {
    864000
}

fn version_ok(version: u32, path: &Path) -> Result<(), Box<dyn Error>> {
    if version == VERSION {
        Ok(())
    } else {
        Err(format!(
            "{} 的 version = {version}，当前只支持 {VERSION}",
            path.display()
        )
        .into())
    }
}

fn read_toml<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, Box<dyn Error>> {
    let text =
        std::fs::read_to_string(path).map_err(|e| format!("读取 {} 失败：{e}", path.display()))?;
    toml::from_str(&text).map_err(|e| format!("解析 {} 失败：{e}", path.display()).into())
}

/// 读 app 文件并校验 version。
pub fn read_app(path: &Path) -> Result<AppFile, Box<dyn Error>> {
    let app: AppFile = read_toml(path)?;
    version_ok(app.version, path)?;
    Ok(app)
}

/// 读 secret 文件；文件不存在或没有 [jwt].secret 时返回 None。
pub fn read_secret(path: &Path) -> Result<Option<String>, Box<dyn Error>> {
    if !path.is_file() {
        return Ok(None);
    }
    let secret: SecretFile = read_toml(path)?;
    version_ok(secret.version, path)?;
    Ok(secret.jwt.secret.filter(|s| !s.trim().is_empty()))
}

/// 展开成 Config::from_vars 使用的扁平键表。
pub fn to_map(app: AppFile) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    map.insert("SERVICE_PORT".into(), app.server.port.to_string());
    map.insert("BIND_HOST".into(), app.server.bind);
    map.insert(
        "ALLOW_REGISTER".into(),
        if app.security.allow_register {
            "true".into()
        } else {
            "false".into()
        },
    );
    map.insert("JWT_TTL_SECS".into(), app.security.jwt_ttl_secs.to_string());
    if !app.cors.allow_origins.is_empty() {
        map.insert("CORS_ALLOW_ORIGIN".into(), app.cors.allow_origins.join(","));
    }
    let _ = app.site;
    if let Some(file) = app.database.file {
        map.insert("DATABASE_FILE".into(), file);
    }
    if let Some(url) = app.database.url {
        map.insert("DATABASE_URL".into(), url);
    }
    if let Some(dir) = app.uploads.dir {
        map.insert("UPLOAD_DIR".into(), dir);
    }
    if let Some(dir) = app.backup.dir {
        map.insert("BACKUP_DIR".into(), dir);
    }
    if let Some(path) = app.ffmpeg.path {
        map.insert("FFMPEG_PATH".into(), path);
    }
    let _ = app.frontend;
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_app_fields_to_config_keys() {
        let text = r#"
version = 1
[server]
port = 9090
bind = "0.0.0.0"
[security]
allow_register = true
jwt_ttl_secs = 60
[cors]
allow_origins = ["https://a", "http://b"]
[database]
file = "prod.db"
"#;
        let app: AppFile = toml::from_str(text).unwrap();
        let map = to_map(app);
        assert_eq!(map.get("SERVICE_PORT").map(String::as_str), Some("9090"));
        assert_eq!(map.get("BIND_HOST").map(String::as_str), Some("0.0.0.0"));
        assert_eq!(map.get("ALLOW_REGISTER").map(String::as_str), Some("true"));
        assert_eq!(map.get("JWT_TTL_SECS").map(String::as_str), Some("60"));
        assert_eq!(
            map.get("CORS_ALLOW_ORIGIN").map(String::as_str),
            Some("https://a,http://b")
        );
        assert_eq!(
            map.get("DATABASE_FILE").map(String::as_str),
            Some("prod.db")
        );
    }
}
