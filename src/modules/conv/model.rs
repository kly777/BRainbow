use serde::{Deserialize, Serialize};

/// 搜索范围：搜知识条目（conv）、搜文章（article），还是都搜。
///
/// 以前值域只写在字段注释里（`// "all" | "conv" | "article"`），handler 取默认值后
/// **不校验**就透传进 repository，于是 `search_type=xxx`（或任何拼错的）既不报错也不
/// 提示，只会因为两个 `==` 都不成立而"两条都不搜" —— 返回空结果看起来像"没匹配到"。
/// 收成枚举后这种输入在反序列化时就被拒（走 `app/http/rejection.rs` 的统一形）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchScope {
    #[default]
    All,
    Conv,
    Article,
}

impl SearchScope {
    /// 是否搜知识条目标题。
    pub fn searches_conv(self) -> bool {
        matches!(self, Self::All | Self::Conv)
    }

    /// 是否搜文章正文。
    pub fn searches_articles(self) -> bool {
        matches!(self, Self::All | Self::Article)
    }
}

#[derive(Deserialize)]
pub struct SearchParams {
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    /// 缺省 `all`（两边都搜）；写错的值会在这里被 serde 拒掉
    #[serde(default)]
    pub search_type: SearchScope,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_scope_searches_both_sides() {
        // 缺省必须是"都搜"：handler 以前写死 unwrap_or("all")，那条默认值跟着
        // SearchScope::default 走，别让它悄悄变成只搜一边
        let params: SearchParams = serde_json::from_str(r#"{}"#).unwrap();
        assert_eq!(params.search_type, SearchScope::All);
        assert!(params.search_type.searches_conv());
        assert!(params.search_type.searches_articles());
    }

    #[test]
    fn each_scope_decides_which_sides_to_search() {
        for (raw, conv, article) in [
            ("all", true, true),
            ("conv", true, false),
            ("article", false, true),
        ] {
            let params: SearchParams =
                serde_json::from_str(&format!(r#"{{"search_type":"{raw}"}}"#)).unwrap();
            assert_eq!(params.search_type.searches_conv(), conv, "{raw}");
            assert_eq!(params.search_type.searches_articles(), article, "{raw}");
        }
    }

    #[test]
    fn an_unrecognised_scope_is_rejected_instead_of_silently_matching_nothing() {
        // 改造前：search_type=xxx 两个 `==` 都不成立 → 返回空结果，看起来像"没匹配到"
        for bad in [r#""xxx""#, r#""conv ""#, r#""Conv""#, r#""""#] {
            let parsed: Result<SearchParams, _> =
                serde_json::from_str(&format!(r#"{{"search_type":{bad}}}"#));
            assert!(parsed.is_err(), "{bad} 本该被拒");
        }
    }
}

#[derive(Serialize)]
pub struct ConvHit {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub snippet: String,
    pub match_field: String,
    pub created_at: String,
    pub score: i64,
    /// 文章模式下，存具体文章标题
    #[serde(skip_serializing_if = "Option::is_none")]
    pub article_title: Option<String>,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub hits: Vec<ConvHit>,
    pub total: i64,
}

#[derive(Serialize)]
pub struct ConvDetail {
    pub conv_id: i64,
    pub title: String,
    pub conv_type: String,
    pub created_at: String,
    pub articles: Vec<ArticleItem>,
}

#[derive(Serialize)]
pub struct ArticleItem {
    pub article_type: String,
    pub title: String,
    pub content: String,
}
