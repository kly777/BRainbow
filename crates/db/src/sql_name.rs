//! SQL 标识符白名单：动态表名/列名进入 SQL 前必须经过这里。

use sqlx::Error;

/// 校验 SQLite 标识符：只允许字母、数字、下划线。
///
/// 动态表名/列名不能直接拼接用户输入；这个函数是唯一入口，
/// 通过后调用方仍需用 `AssertSqlSafe` 明确标记。
pub fn sanitize_table_name(name: &str) -> Result<String, Error> {
    if name.is_empty() || !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
        return Err(Error::Protocol(format!("invalid table name: '{name}'")));
    }
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::sanitize_table_name;

    #[test]
    fn accepts_identifier() {
        assert_eq!(sanitize_table_name("cards").unwrap(), "cards");
        assert_eq!(sanitize_table_name("user_data").unwrap(), "user_data");
        assert_eq!(sanitize_table_name("my_table_1").unwrap(), "my_table_1");
    }

    #[test]
    fn rejects_empty() {
        assert!(sanitize_table_name("").is_err());
    }
}
