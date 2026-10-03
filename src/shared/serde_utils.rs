//! serde 辅助：本项目里少数几个"字段的两种缺席"要分得开的 DTO。

use serde::{Deserialize, Deserializer};

/// 双层 `Option` 的反序列化：**区分"字段没出现"与"字段是 null"**。
///
/// 部分更新（PATCH）里这两件事含义不同：
///
/// | 请求体 | 内层 | 含义 |
/// |---|---|---|
/// | 字段缺席 | `None` | 不改这一项 |
/// | `"due_at": null` | `Some(None)` | 清空这一项 |
/// | `"due_at": "…"` | `Some(Some(…))` | 改成这个值 |
///
/// **为什么不写 `Option<Option<T>>` 就完事**：serde 对 `Option<T>` 的 null 直接走
/// `visit_none`，于是 JSON null 会被读成外层的 `None`（= 不改）—— `Some(None)` 这个分支
/// **永远走不到**，前端发 `"description": null` 想清空描述时会被静默忽略（真实踩过：
/// `/tasks/{id}` 的 PATCH 上，描述/父任务/工时三处的"清空"分支都是死代码）。
///
/// 用法：`#[serde(default, deserialize_with = "double_option")]`。
pub fn double_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    // 能进到这个函数说明**字段出现了** —— 值本身（含 null）交给内层去读
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use serde::Serialize;

    #[derive(Debug, Serialize, Deserialize)]
    struct Patch {
        #[serde(default, deserialize_with = "double_option")]
        value: Option<Option<String>>,
    }

    #[test]
    fn missing_field_means_leave_alone() {
        let patch: Patch = serde_json::from_str("{}").unwrap();
        assert_eq!(patch.value, None);
    }

    #[test]
    fn null_means_clear() {
        let patch: Patch = serde_json::from_str(r#"{"value":null}"#).unwrap();
        assert_eq!(patch.value, Some(None));
    }

    #[test]
    fn value_means_set() {
        let patch: Patch = serde_json::from_str(r#"{"value":"x"}"#).unwrap();
        assert_eq!(patch.value, Some(Some("x".into())));
    }
}
