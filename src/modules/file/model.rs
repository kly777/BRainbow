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
    pub tags: Vec<String>,
    pub meta: std::collections::HashMap<String, String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
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
    pub tags: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// 更新文件请求
#[derive(Debug, Deserialize)]
pub struct UpdateFileRequest {
    pub original_name: Option<String>,
    pub tags: Option<Vec<String>>,
    pub meta: Option<std::collections::HashMap<String, String>>,
}

/// 文件列表查询参数
#[derive(Debug, Deserialize)]
pub struct FileListQuery {
    pub page: Option<i64>,
    pub page_size: Option<i64>,
    pub category: Option<String>,
    pub tag: Option<String>,
    pub q: Option<String>,
}

/// 标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTag {
    pub id: i64,
    pub name: String,
    pub user_id: i64,
}
