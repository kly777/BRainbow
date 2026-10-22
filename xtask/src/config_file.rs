//! TOML 配置读取与旧键映射。
//!
//! xtask 的内部字段仍沿用部署脚本时代的键名；这里只负责把 config/*.toml
//! 展开成扁平表，路径派生与校验仍由 config::Config::from_vars 负责。

use std::collections::BTreeMap;
use std::path::Path;

use serde::Deserialize;

use crate::error::{Error, Result};

const CONFIG_VERSION: u32 = 1;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeployFile {
    version: u32,
    remote: Remote,
    #[serde(default)]
    backup: Backup,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Remote {
    host: String,
    user: String,
    #[serde(default = "default_remote_port")]
    port: u16,
    #[serde(default = "default_remote_base")]
    base: String,
    app: String,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Backup {
    #[serde(default = "default_retain_days")]
    retain_days: u32,
    #[serde(default = "default_retain_count")]
    retain_count: usize,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AppFile {
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
    backup: BackupDir,
    #[serde(default)]
    ffmpeg: Ffmpeg,
    #[serde(default)]
    frontend: Frontend,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Server {
    #[serde(default = "default_service_port")]
    port: u16,
    #[serde(default = "default_bind_host")]
    bind: String,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Security {
    #[serde(default)]
    allow_register: bool,
    #[serde(default = "default_jwt_ttl")]
    jwt_ttl_secs: i64,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Site {
    #[serde(default)]
    url: Option<String>,
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
    #[serde(default, rename = "dir")]
    _dir: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct BackupDir {
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
struct BuildFile {
    version: u32,
    #[serde(default)]
    build: Build,
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct Build {
    #[serde(default)]
    target: Option<String>,
    #[serde(default)]
    with_ffprobe: bool,
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

fn default_remote_port() -> u16 {
    22
}
fn default_remote_base() -> String {
    "/opt".into()
}
fn default_retain_days() -> u32 {
    30
}
fn default_retain_count() -> usize {
    20
}
fn default_service_port() -> u16 {
    8080
}
fn default_bind_host() -> String {
    "0.0.0.0".into()
}
fn default_jwt_ttl() -> i64 {
    864000
}

fn read_toml<T: for<'de> Deserialize<'de>>(path: &Path, what: &str) -> Result<T> {
    let text = std::fs::read_to_string(path).map_err(|e| {
        Error::io(
            format!(
                "读取 {what} {}（模板见 {}.example.toml）",
                path.display(),
                path.display()
            ),
            e,
        )
    })?;
    toml::from_str(&text)
        .map_err(|e| Error::msg(format!("解析 {what} {} 失败：{e}", path.display())))
}

fn check_version(version: u32, path: &Path) -> Result<()> {
    if version == CONFIG_VERSION {
        Ok(())
    } else {
        Err(Error::msg(format!(
            "{} 的 version = {version}，当前只支持 {CONFIG_VERSION}",
            path.display()
        )))
    }
}

fn put(map: &mut BTreeMap<String, String>, key: &str, value: impl Into<String>) {
    let value = value.into();
    if !value.trim().is_empty() {
        map.insert(key.to_string(), value);
    }
}

/// 把 config/*.toml 展开成 xtask 内部使用的扁平键表。
///
/// app.prod.toml / deploy.toml / build.toml 必需；secret.toml 可选。
pub fn load(config_dir: &Path) -> Result<BTreeMap<String, String>> {
    let deploy_path = config_dir.join("deploy.toml");
    let app_path = config_dir.join("app.prod.toml");
    let build_path = config_dir.join("build.toml");

    let deploy: DeployFile = read_toml(&deploy_path, "部署配置")?;
    check_version(deploy.version, &deploy_path)?;
    let app: AppFile = read_toml(&app_path, "应用配置")?;
    check_version(app.version, &app_path)?;
    let build: BuildFile = read_toml(&build_path, "构建配置")?;
    check_version(build.version, &build_path)?;

    let mut map = BTreeMap::new();

    put(&mut map, "REMOTE_HOST", deploy.remote.host);
    put(&mut map, "REMOTE_USER", deploy.remote.user);
    put(&mut map, "REMOTE_PORT", deploy.remote.port.to_string());
    put(&mut map, "REMOTE_BASE", deploy.remote.base);
    put(&mut map, "APP_NAME", deploy.remote.app);
    put(
        &mut map,
        "BACKUP_RETAIN_DAYS",
        deploy.backup.retain_days.to_string(),
    );
    put(
        &mut map,
        "BACKUP_RETAIN_COUNT",
        deploy.backup.retain_count.to_string(),
    );

    put(&mut map, "SERVICE_PORT", app.server.port.to_string());
    put(&mut map, "BIND_HOST", app.server.bind);
    put(
        &mut map,
        "ALLOW_REGISTER",
        if app.security.allow_register {
            "true"
        } else {
            "false"
        },
    );
    put(
        &mut map,
        "JWT_TTL_SECS",
        app.security.jwt_ttl_secs.to_string(),
    );
    if !app.cors.allow_origins.is_empty() {
        put(
            &mut map,
            "CORS_ALLOW_ORIGIN",
            app.cors.allow_origins.join(","),
        );
    }
    if let Some(url) = app.site.url {
        put(&mut map, "DOMAIN", host_from_url(&url)?);
    }
    if let Some(file) = app.database.file {
        put(&mut map, "DATABASE_FILE", file);
    }
    if let Some(url) = app.database.url {
        put(&mut map, "DATABASE_URL", url);
    }
    if let Some(dir) = app.backup.dir {
        put(&mut map, "BACKUP_DIR", dir);
    }
    if let Some(path) = app.ffmpeg.path {
        put(&mut map, "FFMPEG_PATH", path);
    }
    let _ = app.frontend;
    let _ = app.uploads;

    if let Some(target) = build.build.target {
        put(&mut map, "BUILD_TARGET", target);
    }
    put(
        &mut map,
        "WITH_FFPROBE",
        if build.build.with_ffprobe { "1" } else { "0" },
    );

    let secret_path = config_dir.join("secret.toml");
    if secret_path.is_file() {
        let secret: SecretFile = read_toml(&secret_path, "密钥配置")?;
        check_version(secret.version, &secret_path)?;
        if let Some(secret) = secret.jwt.secret {
            if secret == "replace-with-openssl-rand-hex-32" {
                return Err(Error::msg(format!(
                    "{} 的 [jwt].secret 还是模板占位值，请换成 openssl rand -hex 32 的输出",
                    secret_path.display()
                )));
            }
            put(&mut map, "JWT_SECRET", secret);
        }
    }

    Ok(map)
}

/// 从站点 URL 取 Caddy 需要的 host。
fn host_from_url(raw: &str) -> Result<String> {
    let rest = raw
        .strip_prefix("https://")
        .or_else(|| raw.strip_prefix("http://"))
        .ok_or_else(|| Error::msg(format!("site.url 必须是 http(s) URL：{raw:?}")))?;
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").trim();
    if host.is_empty() {
        return Err(Error::msg(format!("site.url 缺少主机名：{raw:?}")));
    }
    Ok(host.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn host_strips_scheme_path_and_query() {
        assert_eq!(
            host_from_url("https://brainbow.top/").unwrap(),
            "brainbow.top"
        );
        assert_eq!(
            host_from_url("http://127.0.0.1:8080/x").unwrap(),
            "127.0.0.1:8080"
        );
    }

    #[test]
    fn rejects_non_url_site() {
        assert!(host_from_url("brainbow.top").is_err());
    }

    #[test]
    fn loads_all_four_files_and_maps_legacy_keys() {
        let dir = std::env::temp_dir().join(format!(
            "xtask-config-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("deploy.toml"),
            "version = 1\n[remote]\nhost = \"203.0.113.7\"\nuser = \"kly\"\napp = \"brb\"\n[backup]\nretain_days = 7\nretain_count = 3\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("app.prod.toml"),
            "version = 1\n[server]\nport = 9090\nbind = \"127.0.0.1\"\n[site]\nurl = \"https://example.test/path\"\n[cors]\nallow_origins = [\"https://a\", \"https://b\"]\n[security]\nallow_register = true\njwt_ttl_secs = 60\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("build.toml"),
            "version = 1\n[build]\ntarget = \"x86_64-unknown-linux-musl\"\nwith_ffprobe = true\n",
        )
        .unwrap();
        std::fs::write(
            dir.join("secret.toml"),
            "version = 1\n[jwt]\nsecret = \"deadbeef\"\n",
        )
        .unwrap();

        let map = load(&dir).unwrap();
        assert_eq!(
            map.get("REMOTE_HOST").map(String::as_str),
            Some("203.0.113.7")
        );
        assert_eq!(map.get("SERVICE_PORT").map(String::as_str), Some("9090"));
        assert_eq!(map.get("DOMAIN").map(String::as_str), Some("example.test"));
        assert_eq!(
            map.get("CORS_ALLOW_ORIGIN").map(String::as_str),
            Some("https://a,https://b")
        );
        assert_eq!(map.get("ALLOW_REGISTER").map(String::as_str), Some("true"));
        assert_eq!(
            map.get("BUILD_TARGET").map(String::as_str),
            Some("x86_64-unknown-linux-musl")
        );
        assert_eq!(map.get("WITH_FFPROBE").map(String::as_str), Some("1"));
        assert_eq!(map.get("JWT_SECRET").map(String::as_str), Some("deadbeef"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
