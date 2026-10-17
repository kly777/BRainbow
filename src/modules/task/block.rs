//! 任务时间块（feasible / planned）：原 time_window 的替代。
//!
//! - `planned`：已排期；`fixed=1` 是固定安排，`end_at IS NULL` 是“软计划点”。
//! - `feasible`：可选软约束，必须有起止。
//! - `actual` 已移除（不再做实际用时）。
//!
//! 时间块是 task 的从属数据，归属回到 task 上判（越权按不存在 → 404）。

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;

use super::repository::TaskRepository;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct TaskBlock {
    pub id: i32,
    pub user_id: Option<i32>,
    pub task_id: i32,
    pub kind: String,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub fixed: i64,
    pub source: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTaskBlockRequest {
    pub kind: String,
    pub start_at: DateTime<Utc>,
    #[serde(default)]
    pub end_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub fixed: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateTaskBlockRequest {
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub start_at: Option<DateTime<Utc>>,
    #[serde(
        default,
        deserialize_with = "crate::shared::serde_utils::double_option"
    )]
    pub end_at: Option<Option<DateTime<Utc>>>,
    #[serde(default)]
    pub fixed: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TaskBlockResponse {
    pub id: i32,
    pub task_id: i32,
    pub kind: String,
    pub start_at: DateTime<Utc>,
    pub end_at: Option<DateTime<Utc>>,
    pub fixed: bool,
    pub source: String,
}

impl From<TaskBlock> for TaskBlockResponse {
    fn from(block: TaskBlock) -> Self {
        Self {
            id: block.id,
            task_id: block.task_id,
            kind: block.kind,
            start_at: block.start_at,
            end_at: block.end_at,
            fixed: block.fixed != 0,
            source: block.source,
        }
    }
}

#[derive(Clone)]
pub struct TaskBlockService {
    db: Arc<SqlitePool>,
    tasks: TaskRepository,
}

impl TaskBlockService {
    pub fn new(db: Arc<SqlitePool>) -> Self {
        Self {
            tasks: TaskRepository::new(db.clone()),
            db,
        }
    }

    pub async fn list_by_task(
        &self,
        actor: &Actor,
        task_id: i32,
    ) -> Result<Vec<TaskBlock>, ServiceError> {
        self.ensure_task_owned(actor, task_id).await?;
        self.by_task_unscoped(task_id).await
    }

    pub async fn create(
        &self,
        actor: &Actor,
        task_id: i32,
        req: CreateTaskBlockRequest,
    ) -> Result<TaskBlock, ServiceError> {
        let owner = self.ensure_task_owned(actor, task_id).await?;
        let kind = validate_kind(&req.kind)?;
        let block = self.validate_shape(kind, req.start_at, req.end_at, req.fixed, task_id)?;
        if block.kind == "planned" && block.end_at.is_some() {
            self.ensure_no_overlap(owner, block.start_at, block.end_at, None)
                .await?;
        }
        let id = self
            .insert(
                owner,
                task_id,
                &block.kind,
                block.start_at,
                block.end_at,
                block.fixed,
                "manual",
            )
            .await
            .map_err(ServiceError::Db)?;
        self.find_unscoped(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::Internal("时间块写入后读不到".into()))
    }

    /// 给 task 创建路径用（点日历空白新建）
    pub async fn create_for_task(
        &self,
        actor: &Actor,
        task_id: i32,
        start_at: DateTime<Utc>,
        end_at: DateTime<Utc>,
        kind: &str,
    ) -> Result<TaskBlock, ServiceError> {
        self.create(
            actor,
            task_id,
            CreateTaskBlockRequest {
                kind: kind.to_string(),
                start_at,
                end_at: Some(end_at),
                fixed: false,
            },
        )
        .await
    }

    pub async fn update(
        &self,
        actor: &Actor,
        id: i32,
        req: UpdateTaskBlockRequest,
    ) -> Result<TaskBlock, ServiceError> {
        let existing = self
            .find_unscoped(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("时间块不存在".into()))?;
        let owner = self.ensure_task_owned(actor, existing.task_id).await?;

        let kind = match req.kind.as_deref() {
            Some(value) => validate_kind(value)?,
            None => existing.kind.clone(),
        };
        let start_at = req.start_at.unwrap_or(existing.start_at);
        let end_at = match req.end_at {
            None => existing.end_at,
            Some(value) => value,
        };
        let fixed = req.fixed.unwrap_or(existing.fixed != 0);
        let block = self.validate_shape(kind, start_at, end_at, fixed, existing.task_id)?;
        if block.kind == "planned" && block.end_at.is_some() {
            self.ensure_no_overlap(owner, block.start_at, block.end_at, Some(id))
                .await?;
        }
        let now = Utc::now();
        sqlx::query(
            "UPDATE task_block SET kind = ?, start_at = ?, end_at = ?, fixed = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(&block.kind)
        .bind(block.start_at)
        .bind(block.end_at)
        .bind(i64::from(block.fixed))
        .bind(now)
        .bind(id)
        .execute(&*self.db)
        .await
        .map_err(ServiceError::Db)?;
        self.find_unscoped(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("时间块不存在".into()))
    }

    pub async fn delete(&self, actor: &Actor, id: i32) -> Result<u64, ServiceError> {
        let existing = self
            .find_unscoped(id)
            .await
            .map_err(ServiceError::Db)?
            .ok_or_else(|| ServiceError::NotFound("时间块不存在".into()))?;
        self.ensure_task_owned(actor, existing.task_id).await?;
        let result = sqlx::query("DELETE FROM task_block WHERE id = ?1")
            .bind(id)
            .execute(&*self.db)
            .await
            .map_err(ServiceError::Db)?;
        Ok(result.rows_affected())
    }

    /// 日历/建议读：区间内所有用户的 planned/feasible 块
    pub async fn list_range(
        &self,
        actor: &Actor,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<Vec<TaskBlock>, ServiceError> {
        sqlx::query_as::<_, TaskBlock>(
            r#"SELECT b.id, b.user_id, b.task_id, b.kind, b.start_at, b.end_at,
                      b.fixed, b.source, b.created_at, b.updated_at
               FROM task_block b
               JOIN task t ON t.id = b.task_id
               WHERE (?1 IS NULL OR t.user_id = ?1)
                 AND b.start_at < ?3
                 AND (b.end_at IS NULL OR b.end_at > ?2)
               ORDER BY b.start_at"#,
        )
        .bind(actor.owner_scope())
        .bind(start)
        .bind(end)
        .fetch_all(&*self.db)
        .await
        .map_err(ServiceError::Db)
    }

    async fn by_task_unscoped(&self, task_id: i32) -> Result<Vec<TaskBlock>, ServiceError> {
        sqlx::query_as::<_, TaskBlock>(
            r#"SELECT id, user_id, task_id, kind, start_at, end_at, fixed, source,
                      created_at, updated_at
               FROM task_block WHERE task_id = ?1 ORDER BY start_at"#,
        )
        .bind(task_id)
        .fetch_all(&*self.db)
        .await
        .map_err(ServiceError::Db)
    }

    async fn find_unscoped(&self, id: i32) -> Result<Option<TaskBlock>, sqlx::Error> {
        sqlx::query_as::<_, TaskBlock>(
            r#"SELECT id, user_id, task_id, kind, start_at, end_at, fixed, source,
                      created_at, updated_at
               FROM task_block WHERE id = ?1"#,
        )
        .bind(id)
        .fetch_optional(&*self.db)
        .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn insert(
        &self,
        user_id: i32,
        task_id: i32,
        kind: &str,
        start_at: DateTime<Utc>,
        end_at: Option<DateTime<Utc>>,
        fixed: bool,
        source: &str,
    ) -> Result<i32, sqlx::Error> {
        let now = Utc::now();
        let id: i32 = sqlx::query_scalar(
            r#"INSERT INTO task_block (
                   user_id, task_id, kind, start_at, end_at, fixed, source,
                   created_at, updated_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               RETURNING id"#,
        )
        .bind(user_id)
        .bind(task_id)
        .bind(kind)
        .bind(start_at)
        .bind(end_at)
        .bind(i64::from(fixed))
        .bind(source)
        .bind(now)
        .bind(now)
        .fetch_one(&*self.db)
        .await?;
        Ok(id)
    }

    async fn ensure_task_owned(&self, actor: &Actor, task_id: i32) -> Result<i32, ServiceError> {
        let owner = self
            .tasks
            .owner_of(task_id)
            .await
            .map_err(ServiceError::Db)?;
        match owner {
            Some(Some(owner)) if actor.can_write(Some(owner)) => {
                i32::try_from(owner).map_err(|_| ServiceError::Internal("归属 id 越界".into()))
            }
            _ => Err(ServiceError::NotFound("任务不存在".into())),
        }
    }

    fn validate_shape(
        &self,
        kind: String,
        start_at: DateTime<Utc>,
        end_at: Option<DateTime<Utc>>,
        fixed: bool,
        _task_id: i32,
    ) -> Result<BlockShape, ServiceError> {
        if let Some(end) = end_at
            && end <= start_at
        {
            return Err(ServiceError::InvalidInput(
                "结束时间必须晚于开始时间".into(),
            ));
        }
        if fixed && end_at.is_none() {
            return Err(ServiceError::InvalidInput(
                "固定安排必须同时有开始与结束".into(),
            ));
        }
        if kind == "feasible" && end_at.is_none() {
            return Err(ServiceError::InvalidInput("可行时段必须有结束时间".into()));
        }
        Ok(BlockShape {
            kind,
            start_at,
            end_at,
            fixed,
        })
    }

    async fn ensure_no_overlap(
        &self,
        owner: i32,
        start_at: DateTime<Utc>,
        end_at: Option<DateTime<Utc>>,
        exclude_id: Option<i32>,
    ) -> Result<(), ServiceError> {
        let Some(end_at) = end_at else {
            return Ok(());
        };
        let count: i64 = sqlx::query_scalar(
            r#"SELECT COUNT(*)
               FROM task_block b
               JOIN task t ON t.id = b.task_id
               WHERE t.user_id = ?1
                 AND b.kind = 'planned'
                 AND b.end_at IS NOT NULL
                 AND b.start_at < ?3
                 AND b.end_at > ?2
                 AND (?4 IS NULL OR b.id <> ?4)"#,
        )
        .bind(owner)
        .bind(start_at)
        .bind(end_at)
        .bind(exclude_id)
        .fetch_one(&*self.db)
        .await
        .map_err(ServiceError::Db)?;
        if count > 0 {
            return Err(ServiceError::InvalidInput("这段时间已经有一件事了".into()));
        }
        Ok(())
    }
}

struct BlockShape {
    kind: String,
    start_at: DateTime<Utc>,
    end_at: Option<DateTime<Utc>>,
    fixed: bool,
}

fn validate_kind(value: &str) -> Result<String, ServiceError> {
    match value {
        "feasible" | "planned" => Ok(value.to_string()),
        other => Err(ServiceError::InvalidInput(format!(
            "未知时间块类型: {other}"
        ))),
    }
}
