//! systemd unit 与 Caddyfile 的模板渲染。
//!
//! 取代 `sed -e "s|@@KEY@@|$value|g"`。老写法有三个坑，这里都堵上了：
//!
//! 1. **`sed` 替换串里的 `&` 表示"整个匹配"**，值里出现 `&` 就会把
//!    `&` 展开成 `@@KEY@@` 本身；`|` 会直接改变 `s|…|…|g` 的分隔符结构。
//!    CORS_ALLOW_ORIGIN 这类值带查询串时很容易踩到。
//! 2. **漏填占位符是静默的**：模板新增一个 `@@X@@` 而渲染处没传值，
//!    unit 里就会留一个字符串 `@@X@@`，systemd 多半照收不误。
//! 3. **值里的换行等于注入指令** —— 一个含 `\n` 的值能往 unit 里插任意一行。
//!
//! 模板文件沿用原来的 `@@KEY@@` 语法，所以 `deploy/brainbow.service` 与
//! `deploy/Caddyfile` 本身不用改。

use std::path::Path;

use crate::config::Config;
use crate::error::{Error, Result};

/// 把模板里的 `@@KEY@@` 换成值。
pub fn render(template: &str, what: &str, values: &[(&str, String)]) -> Result<String> {
    let mut out = template.to_string();
    for (key, value) in values {
        let placeholder = format!("@@{key}@@");
        if !out.contains(&placeholder) {
            return Err(Error::msg(format!(
                "{what} 模板里没有 {placeholder}（模板与渲染代码不一致）"
            )));
        }
        if value.contains('\n') || value.contains('\r') {
            return Err(Error::msg(format!(
                "{what} 的 {key} 含换行，会往配置里注入新指令，拒绝渲染"
            )));
        }
        out = out.replace(&placeholder, value);
    }
    if let Some(left) = find_placeholder(&out) {
        return Err(Error::msg(format!(
            "{what} 渲染后仍残留 {left}：模板新增了占位符，但渲染处没有传对应的值"
        )));
    }
    Ok(out)
}

/// 找出第一个 `@@…@@` 片段。
fn find_placeholder(text: &str) -> Option<&str> {
    let start = text.find("@@")?;
    let rest = &text[start..];
    // `@@` 是 ASCII，切片位置一定落在字符边界上。
    let end = rest.get(2..)?.find("@@")? + 2;
    rest.get(..end + 2)
}

fn read_template(project_dir: &Path, name: &str) -> Result<String> {
    let path = project_dir.join("deploy").join(name);
    std::fs::read_to_string(&path).map_err(|e| {
        Error::io(
            format!("读取模板 {}（它应当随仓库一起存在）", path.display()),
            e,
        )
    })
}

/// 渲染 systemd unit。占位符与 deploy.sh 时代的同名同义。
pub fn systemd_unit(cfg: &Config, jwt_secret: &str) -> Result<String> {
    let template = read_template(&cfg.project_dir, "brainbow.service")?;
    render(
        &template,
        "systemd unit",
        &[
            ("REMOTE_USER", cfg.remote_user.clone()),
            ("SERVICE_DIR", cfg.service_dir.clone()),
            ("SERVICE_PORT", cfg.service_port.to_string()),
            ("BIND_HOST", cfg.bind_host.clone()),
            ("DATABASE_URL", cfg.database_url.clone()),
            ("UPLOAD_DIR", cfg.upload_dir.clone()),
            // 应用侧的 /admin 服务器信息要报"备份多少份、占多大"，所以把备份目录
            // 一并注入 —— 部署工具知道它在哪，应用只读
            ("BACKUP_DIR", cfg.backup_dir.clone()),
            ("CORS_ALLOW_ORIGIN", cfg.cors_allow_origin.clone()),
            ("JWT_SECRET", jwt_secret.to_string()),
            ("ALLOW_REGISTER", cfg.allow_register.clone()),
            ("JWT_TTL_SECS", cfg.jwt_ttl_secs.clone()),
        ],
    )
}

/// 渲染 Caddy 配置。
pub fn caddyfile(cfg: &Config) -> Result<String> {
    let template = read_template(&cfg.project_dir, "Caddyfile")?;
    render(
        &template,
        "Caddyfile",
        &[
            ("DOMAIN", cfg.domain.clone()),
            ("SERVICE_PORT", cfg.service_port.to_string()),
            ("DIST_DIR", format!("{}/dist", cfg.service_dir)),
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn substitutes_every_placeholder() {
        let out = render(
            "a=@@A@@ b=@@B@@",
            "测试",
            &[("A", "1".into()), ("B", "2".into())],
        )
        .expect("渲染应当成功");
        assert_eq!(out, "a=1 b=2");
    }

    #[test]
    fn shell_and_sed_metacharacters_pass_through_literally() {
        // 这些正是 `sed "s|@@X@@|$X|g"` 会咬坏的值：`&` 在 sed 里表示整个匹配，
        // `|` 会破坏分隔符。这里必须原样落地。
        let value = "https://a.test/?x=1&y=2|z\\w$HOME`id`\"q\"'s'";
        let out =
            render("CORS=@@CORS@@\n", "测试", &[("CORS", value.into())]).expect("渲染应当成功");
        assert_eq!(out, format!("CORS={value}\n"));
    }

    #[test]
    fn rejects_leftover_placeholder() {
        // 模板新增了 @@NEW@@ 但渲染处忘了传值 —— 老写法会把它原样发给 systemd。
        let err = render("a=@@A@@\nb=@@NEW@@\n", "systemd unit", &[("A", "1".into())])
            .expect_err("残留占位符应当报错");
        let text = err.to_string();
        assert!(text.contains("@@NEW@@"), "{text}");
        assert!(text.contains("残留"), "{text}");
    }

    #[test]
    fn rejects_placeholder_absent_from_template() {
        let err = render(
            "a=@@A@@",
            "测试",
            &[("A", "1".into()), ("NOPE", "x".into())],
        )
        .expect_err("模板里没有的占位符应当报错");
        assert!(err.to_string().contains("@@NOPE@@"), "{err}");
    }

    #[test]
    fn rejects_multiline_value() {
        // 含换行的值能往 unit 里注入任意指令（比如再加一行 Environment=）。
        let err = render(
            "a=@@A@@\n",
            "systemd unit",
            &[("A", "1\nExecStart=/bin/sh".into())],
        )
        .expect_err("含换行的值应当被拒绝");
        assert!(err.to_string().contains("注入"), "{err}");
        let err = render("a=@@A@@\n", "systemd unit", &[("A", "1\r\nX".into())])
            .expect_err("CR 同样应当被拒绝");
        assert!(err.to_string().contains("注入"), "{err}");
    }

    #[test]
    fn find_placeholder_locates_the_fragment() {
        assert_eq!(find_placeholder("no placeholder"), None);
        assert_eq!(find_placeholder("@@A@@"), Some("@@A@@"));
        assert_eq!(find_placeholder("x @@A@@ y"), Some("@@A@@"));
        assert_eq!(find_placeholder("x @@A@@ y @@B@@"), Some("@@A@@"));
        // 落单的 `@@` 不算占位符
        assert_eq!(find_placeholder("x @@ y"), None);
    }

    // 下面两个用**真实模板**跑：模板与渲染代码一旦脱节就会失败。

    #[test]
    fn real_systemd_template_renders() {
        let cfg = Config::for_test();
        let unit = systemd_unit(&cfg, "secret-value").expect("真实 unit 模板应当能渲染");
        assert!(!unit.contains("@@"), "不应有占位符残留：\n{unit}");
        assert!(unit.contains("User=kly"), "{unit}");
        assert!(unit.contains("WorkingDirectory=/opt/brb/service"), "{unit}");
        assert!(
            unit.contains("ExecStart=/opt/brb/service/brainbow"),
            "{unit}"
        );
        assert!(
            unit.contains("Environment=\"JWT_SECRET=secret-value\""),
            "{unit}"
        );
        assert!(
            unit.contains("Environment=\"BIND_HOST=127.0.0.1\""),
            "{unit}"
        );
        // 上传根必须注入，且默认值走**部署约定**（data 下）—— 缺了它、或让它退回
        // 后端那个相对的开发默认 `uploads`，用户数据就会落进 service/ 里
        assert!(
            unit.contains("Environment=\"UPLOAD_DIR=/opt/brb/data/uploads\""),
            "上传根应当按约定派生到 data 下: {unit}"
        );
        // 备份目录同理：应用靠它报"备份多少份、占多大"
        assert!(
            unit.contains("Environment=\"BACKUP_DIR=/opt/brb/backup\""),
            "备份目录应当注入: {unit}"
        );
        // 默认值（.env.prod 里没写这两项时）
        assert!(
            unit.contains("Environment=\"ALLOW_REGISTER=false\""),
            "{unit}"
        );
        assert!(
            unit.contains("Environment=\"JWT_TTL_SECS=864000\""),
            "{unit}"
        );
    }

    #[test]
    fn real_caddy_template_renders() {
        let cfg = Config::for_test();
        let caddy = caddyfile(&cfg).expect("真实 Caddyfile 模板应当能渲染");
        assert!(!caddy.contains("@@"), "不应有占位符残留：\n{caddy}");
        assert!(caddy.contains("example.test {"), "{caddy}");
        assert!(caddy.contains("reverse_proxy localhost:8080"), "{caddy}");
        assert!(caddy.contains("root * /opt/brb/service/dist"), "{caddy}");
        // Caddy 那一面承载对外功能，这几条规则不能在渲染中丢掉
        assert!(caddy.contains("/.well-known/api-catalog"), "{caddy}");
        assert!(caddy.contains("text/markdown"), "{caddy}");
        assert!(caddy.contains("Content-Security-Policy"), "{caddy}");
    }
}
