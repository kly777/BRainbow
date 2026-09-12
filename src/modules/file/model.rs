use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// 文件类别
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum FileCategory {
    #[serde(rename = "image")]
    Image,
    #[serde(rename = "video")]
    Video,
    #[serde(rename = "audio")]
    Audio,
    #[serde(rename = "document")]
    Document,
    #[serde(rename = "other")]
    Other,
}

impl FileCategory {
    pub fn as_str(&self) -> &'static str {
        match self {
            FileCategory::Image => "image",
            FileCategory::Video => "video",
            FileCategory::Audio => "audio",
            FileCategory::Document => "document",
            FileCategory::Other => "other",
        }
    }

    /// 中文展示名：用于后端生成的用户可见文案（当前只有搜索结果片段）
    pub fn label(&self) -> &'static str {
        match self {
            FileCategory::Image => "图片",
            FileCategory::Video => "视频",
            FileCategory::Audio => "音频",
            FileCategory::Document => "文档",
            FileCategory::Other => "其他",
        }
    }

    pub fn from_mime(mime: &str) -> Self {
        match mime {
            m if m.starts_with("image/") => FileCategory::Image,
            m if m.starts_with("video/") => FileCategory::Video,
            m if m.starts_with("audio/") => FileCategory::Audio,
            m if m.starts_with("text/")
                || m.starts_with("application/pdf")
                || m.starts_with("application/msword")
                || m.starts_with("application/vnd.") =>
            {
                FileCategory::Document
            }
            _ => FileCategory::Other,
        }
    }

    /// 从 DB 存储的类别字符串解析（区别于 from_mime：入参是类别名而非 MIME）
    pub fn from_category_str(s: &str) -> Self {
        match s {
            "image" => FileCategory::Image,
            "video" => FileCategory::Video,
            "audio" => FileCategory::Audio,
            "document" => FileCategory::Document,
            _ => FileCategory::Other,
        }
    }
}

/// 创建文件记录所需的参数
pub struct NewFile<'a> {
    pub stored_id: &'a str,
    pub original_name: &'a str,
    pub mime_type: &'a str,
    pub file_category: &'a str,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub user_id: Option<i64>,
    /// 内容 SHA-256（十六进制）；存量数据可能为 None
    pub content_hash: Option<&'a str>,
    /// 私密文件：仅上传者可见（匿名上传不允许私密，见 FileService::upload）
    pub is_private: bool,
}

/// 文件主模型
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct File {
    pub id: i64,
    pub stored_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub file_category: FileCategory,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub user_id: Option<i64>,
    /// 内容 SHA-256（十六进制）；存量数据可能为 None
    pub content_hash: Option<String>,
    pub tags: Vec<String>,
    pub meta: std::collections::HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 磁盘上找不到对应文件（记录还在，内容已丢失）。
    /// 实时 stat 得出，不落库 —— 文件补回来后会自动恢复正常。
    pub missing: bool,
    /// 私密文件：仅上传者可见
    pub is_private: bool,
}

/// 文件摘要（列表用，不含 meta）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileSummary {
    pub id: i64,
    pub stored_id: String,
    pub original_name: String,
    pub mime_type: String,
    pub file_category: FileCategory,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub duration_ms: Option<i64>,
    pub user_id: Option<i64>,
    /// 内容 SHA-256（十六进制）；存量数据可能为 None
    pub content_hash: Option<String>,
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// 磁盘上找不到对应文件（见 [`File::missing`]）
    pub missing: bool,
    /// 私密文件：仅上传者可见（见 [`File::is_private`]）
    pub is_private: bool,
}

/// 更新文件请求
#[derive(Debug, Deserialize)]
pub struct UpdateFileRequest {
    pub original_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub meta: Option<std::collections::HashMap<String, String>>,
    /// 切换公开/私密（仅上传者本人可改）
    pub is_private: Option<bool>,
}

/// 列表排序方式（白名单枚举：ORDER BY 片段是常量，无注入风险）
#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    #[default]
    CreatedDesc,
    CreatedAsc,
    SizeDesc,
    SizeAsc,
    NameAsc,
    NameDesc,
}

impl SortOrder {
    /// ORDER BY 片段（统一用表别名 f）
    pub fn order_by(&self) -> &'static str {
        match self {
            SortOrder::CreatedDesc => " ORDER BY f.created_at DESC, f.id DESC",
            SortOrder::CreatedAsc => " ORDER BY f.created_at ASC, f.id ASC",
            SortOrder::SizeDesc => " ORDER BY f.size_bytes DESC, f.id DESC",
            SortOrder::SizeAsc => " ORDER BY f.size_bytes ASC, f.id ASC",
            SortOrder::NameAsc => " ORDER BY f.original_name COLLATE NOCASE ASC, f.id ASC",
            SortOrder::NameDesc => " ORDER BY f.original_name COLLATE NOCASE DESC, f.id DESC",
        }
    }
}

/// 文件列表查询参数
#[derive(Debug, Deserialize)]
pub struct FileListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub category: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
    #[serde(default)]
    pub sort: SortOrder,
}

/// 标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTag {
    pub id: i64,
    pub name: String,
    pub user_id: i64,
}

/// 标签 + 关联文件数（标签管理页用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTagWithCount {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

/// 单个类别的占用统计
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CategoryStat {
    pub category: String,
    pub count: i64,
    pub bytes: i64,
}

/// 文件库统计（占用与类别分布）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileStats {
    pub total_count: i64,
    pub total_bytes: i64,
    pub by_category: Vec<CategoryStat>,
}

/// 标签重命名请求
#[derive(Debug, Deserialize)]
pub struct RenameTagRequest {
    pub name: String,
}

/// 标签合并请求（把 from 合并进 to）
#[derive(Debug, Deserialize)]
pub struct MergeTagRequest {
    pub target_id: i64,
}
