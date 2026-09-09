use std::sync::Arc;

use sqlx::SqlitePool;

use super::model::{File, FileCategory, FileListQuery, FileSummary, FileTag};
use super::repository::FileRepository;
use crate::shared::error_types::ServiceError;
use crate::shared::pagination::{PaginatedResponse, Pagination};

/// 查询侧服务——只读查询聚合
#[derive(Clone)]
pub struct FileQueryService {
    repo: FileRepository,
}

impl FileQueryService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            repo: FileRepository::new(db),
        }
    }

    /// 根据 stored_id 获取文件详情（含标签和元信息）
    pub async fn get_by_stored_id(&self, stored_id: &str) -> Result<File, ServiceError> {
        let file_row = self
            .repo
            .find_by_stored_id(stored_id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let tags = self
            .repo
            .get_file_tags(file_row.id)
            .await
            .map_err(ServiceError::Db)?
            .into_iter()
            .map(|t| t.name)
            .collect();

        let meta = self
            .repo
            .get_file_meta(file_row.id)
            .await
            .map_err(ServiceError::Db)?;

        Ok(File {
            id: file_row.id,
            stored_id: file_row.stored_id,
            original_name: file_row.original_name,
            mime_type: file_row.mime_type,
            file_category: FileCategory::from_category_str(&file_row.file_category),
            size_bytes: file_row.size_bytes,
            width: file_row.width,
            height: file_row.height,
            duration_ms: file_row.duration_ms,
            user_id: file_row.user_id,
            tags,
            meta,
            created_at: file_row.created_at,
            updated_at: file_row.updated_at,
        })
    }

    /// 根据 id 获取文件详情
    pub async fn get_by_id(&self, id: i64) -> Result<File, ServiceError> {
        let file_row = self
            .repo
            .find_by_id(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("文件不存在".into()))?;

        let tags = self
            .repo
            .get_file_tags(file_row.id)
            .await
            .map_err(ServiceError::Db)?
            .into_iter()
            .map(|t| t.name)
            .collect();

        let meta = self
            .repo
            .get_file_meta(file_row.id)
            .await
            .map_err(ServiceError::Db)?;

        Ok(File {
            id: file_row.id,
            stored_id: file_row.stored_id,
            original_name: file_row.original_name,
            mime_type: file_row.mime_type,
            file_category: FileCategory::from_category_str(&file_row.file_category),
            size_bytes: file_row.size_bytes,
            width: file_row.width,
            height: file_row.height,
            duration_ms: file_row.duration_ms,
            user_id: file_row.user_id,
            tags,
            meta,
            created_at: file_row.created_at,
            updated_at: file_row.updated_at,
        })
    }

    /// 文件列表（分页）
    pub async fn list(
        &self,
        query: FileListQuery,
        user_id: Option<i64>,
    ) -> Result<PaginatedResponse<FileSummary>, ServiceError> {
        let pagination = Pagination::from_options(query.page, query.page_size);
        let offset = pagination.offset();
        let limit = pagination.limit();

        // 根据查询条件获取总数和列表
        let name_query = query.q.as_deref().filter(|s| !s.trim().is_empty());
        let (total, rows) = if let Some(tag_name) = &query.tag {
            let uid = user_id.ok_or_else(|| ServiceError::InvalidInput("需要登录".into()))?;
            let total = self
                .repo
                .count_by_tag(tag_name, uid, name_query)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_by_tag(tag_name, uid, name_query, limit, offset)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        } else if let Some(q) = name_query {
            // 搜索模式：按文件名模糊匹配
            let total = self
                .repo
                .count_by_name(q, user_id)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .search_by_name(q, user_id, limit, offset)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        } else {
            let total = self
                .repo
                .count(query.category.as_deref(), user_id)
                .await
                .map_err(ServiceError::Db)?;
            let rows = self
                .repo
                .find_all(limit, offset, query.category.as_deref(), user_id)
                .await
                .map_err(ServiceError::Db)?;
            (total, rows)
        };

        // 批量获取标签
        let mut summaries = Vec::with_capacity(rows.len());
        for row in rows {
            let tags = self
                .repo
                .get_file_tags(row.id)
                .await
                .map_err(ServiceError::Db)?
                .into_iter()
                .map(|t| t.name)
                .collect();

            summaries.push(FileSummary {
                id: row.id,
                stored_id: row.stored_id,
                original_name: row.original_name,
                mime_type: row.mime_type,
                file_category: FileCategory::from_category_str(&row.file_category),
                size_bytes: row.size_bytes,
                width: row.width,
                height: row.height,
                duration_ms: row.duration_ms,
                user_id: row.user_id,
                tags,
                created_at: row.created_at,
                updated_at: row.updated_at,
            });
        }

        Ok(PaginatedResponse::new(summaries, total, &pagination))
    }

    /// 获取用户的所有标签
    pub async fn get_user_tags(&self, user_id: i64) -> Result<Vec<FileTag>, ServiceError> {
        self.repo
            .get_user_tags(user_id)
            .await
            .map_err(ServiceError::Db)
    }
}
