//! db_viewer 的数据契约：**查询结果与读取选项的类型都在这里**。
//!
//! 这些类型原先定义在 `handler.rs` 里，于是 `repository`（数据访问层）与 `service`
//! 都要 `use super::handler::…` 反向依赖 HTTP 层 —— 分层倒置（架构债 P0-2 记的
//! 就是这条）。搬到这里之后依赖方向回到 `handler → service → repository → dto`。
//!
//! 留在 `handler.rs` 的是"只对 HTTP 有意义"的那几个：query string 反序列化的
//! `TableDataQuery` / `BackRefQuery`，以及 `options_from_query` 这类 HTTP→领域的映射。

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ColumnInfo {
    pub name: String,
    pub col_type: String,
    /// 是否主键（复合主键时为第一个组件）
    pub is_primary: bool,
    /// 该列引用的目标表（实际外键优先，否则按 `<表名>_id` 启发式识别）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_table: Option<String>,
    /// 目标表中被引用的列（通常为 id）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ref_column: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FilterOp {
    Eq,
    Ne,
    Contains,
    Prefix,
    IsNull,
    NotNull,
    Gt,
    Lt,
}

impl FilterOp {
    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "eq" => Some(Self::Eq),
            "ne" => Some(Self::Ne),
            "contains" => Some(Self::Contains),
            "prefix" => Some(Self::Prefix),
            "null" => Some(Self::IsNull),
            "notnull" => Some(Self::NotNull),
            "gt" => Some(Self::Gt),
            "lt" => Some(Self::Lt),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TableFilter {
    pub column: String,
    pub op: FilterOp,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct TableReadOptions {
    /// 跳转过滤：目标行 id
    pub filter_id: Option<i64>,
    /// 跳转过滤：目标表中的列名
    pub filter_col: Option<String>,
    /// 排序列
    pub sort_col: Option<String>,
    /// 是否降序
    pub sort_desc: bool,
    /// 文本筛选列（旧版单条件筛选，保留兼容）
    pub search_col: Option<String>,
    /// 文本筛选值（子串匹配）
    pub search: Option<String>,
    /// 多条件筛选
    pub filters: Vec<TableFilter>,
}

#[derive(Debug, Serialize)]
pub struct RefPreview {
    /// 目标表
    pub table: String,
    /// 目标行主键/引用键值
    pub id: i64,
    /// 目标行的部分信息（用于外键单元格内联展示）
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct TableData {
    pub header: Vec<ColumnInfo>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total: i64,
    /// 当前页外键值对应的目标行摘要
    pub refs: Vec<RefPreview>,
}

#[derive(Debug, Serialize)]
pub struct BackRefRow {
    /// 来源表行的主键值（用于点击跳回来源表）
    pub key: i64,
    /// 来源行的简短摘要
    pub summary: String,
}

#[derive(Debug, Serialize)]
pub struct BackRefGroup {
    /// 引用当前表的来源表
    pub source_table: String,
    /// 来源表中的外键列
    pub column: String,
    /// 匹配总数（行数可能被截断到 50 条）
    pub total: i64,
    pub rows: Vec<BackRefRow>,
}
