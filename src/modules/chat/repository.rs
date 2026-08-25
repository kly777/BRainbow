use sqlx::{FromRow, SqlitePool};

use crate::shared::db_query::like_contains;
use crate::shared::error_types::ServiceError;
use crate::shared::search::{SearchHit as GlobalSearchHit, SearchTarget, snippet};

use super::model::{NodeItem, PresetItem, SearchResponse, TreeDetail, TreeItem, UpdateTreeRequest};

#[derive(FromRow)]
struct TreeRow {
    id: i64,
    title: String,
    system_prompt: String,
    kind: String,
    created_at: String,
    updated_at: String,
    node_count: i64,
}

#[derive(FromRow)]
struct NodeRow {
    id: i64,
    tree_id: i64,
    parent_id: Option<i64>,
    role: String,
    content: String,
    revised_from: Option<i64>,
    reasoning: Option<String>,
    created_at: String,
}

#[derive(FromRow)]
struct TreePromptRow {
    system_prompt: String,
}

#[derive(FromRow)]
struct PresetRow {
    id: i64,
    name: String,
    content: String,
    created_at: String,
}

#[derive(FromRow)]
struct NodeHitRow {
    tree_id: i64,
    tree_title: String,
    node_id: i64,
    role: String,
    content: String,
    created_at: String,
}

#[derive(FromRow)]
struct TitleHitRow {
    tree_id: i64,
    tree_title: String,
    updated_at: String,
}

#[derive(FromRow)]
struct GlobalChatTitleHitRow {
    id: i64,
    title: String,
}

#[derive(FromRow)]
struct GlobalChatNodeHitRow {
    node_id: i64,
    tree_id: i64,
    title: String,
    content: String,
}

impl From<TreeRow> for TreeItem {
    fn from(row: TreeRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            system_prompt: row.system_prompt,
            kind: row.kind,
            created_at: row.created_at,
            updated_at: row.updated_at,
            node_count: row.node_count,
        }
    }
}

impl From<NodeRow> for NodeItem {
    fn from(row: NodeRow) -> Self {
        Self {
            id: row.id,
            tree_id: row.tree_id,
            parent_id: row.parent_id,
            role: row.role,
            content: row.content,
            revised_from: row.revised_from,
            reasoning: row.reasoning,
            created_at: row.created_at,
        }
    }
}

impl From<PresetRow> for PresetItem {
    fn from(row: PresetRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            content: row.content,
            created_at: row.created_at,
        }
    }
}

/// chat 持久化 repository（具体类型，不引入 dyn）。
#[derive(Clone)]
pub struct ChatRepo {
    pool: SqlitePool,
}

impl ChatRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn list_trees(&self, user_id: i32) -> Result<Vec<TreeItem>, ServiceError> {
        let rows: Vec<TreeRow> = sqlx::query_as!(
            TreeRow,
            r#"SELECT t.id, t.title, t.system_prompt, t.kind,
                      COALESCE(t.created_at, '') AS "created_at!: String",
                      COALESCE(t.updated_at, '') AS "updated_at!: String",
                      (SELECT COUNT(*) FROM chat_node n WHERE n.tree_id = t.id) AS node_count
               FROM chat_tree t WHERE t.user_id = ?1 ORDER BY t.updated_at DESC"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn list_trees_by_kind(
        &self,
        user_id: i32,
        kind: &str,
    ) -> Result<Vec<TreeItem>, ServiceError> {
        let rows: Vec<TreeRow> = sqlx::query_as!(
            TreeRow,
            r#"SELECT t.id, t.title, t.system_prompt, t.kind,
                      COALESCE(t.created_at, '') AS "created_at!: String",
                      COALESCE(t.updated_at, '') AS "updated_at!: String",
                      (SELECT COUNT(*) FROM chat_node n WHERE n.tree_id = t.id) AS node_count
               FROM chat_tree t WHERE t.user_id = ?1 AND t.kind = ?2 ORDER BY t.updated_at DESC"#,
            user_id,
            kind
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn get_tree(
        &self,
        user_id: i32,
        tree_id: i64,
    ) -> Result<Option<TreeDetail>, ServiceError> {
        let tree: Option<TreeRow> = sqlx::query_as!(
            TreeRow,
            r#"SELECT t.id, t.title, t.system_prompt, t.kind,
                      COALESCE(t.created_at, '') AS "created_at!: String",
                      COALESCE(t.updated_at, '') AS "updated_at!: String",
                      (SELECT COUNT(*) FROM chat_node n WHERE n.tree_id = t.id) AS node_count
               FROM chat_tree t WHERE t.id = ?1 AND t.user_id = ?2"#,
            tree_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;

        let Some(tree) = tree else {
            return Ok(None);
        };

        let nodes: Vec<NodeRow> = sqlx::query_as!(
            NodeRow,
            r#"SELECT id, tree_id, parent_id, role, content, revised_from, reasoning,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM chat_node WHERE tree_id = ?1 ORDER BY id"#,
            tree_id
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(Some(TreeDetail {
            tree: tree.into(),
            nodes: nodes.into_iter().map(Into::into).collect(),
        }))
    }

    pub async fn create_tree(
        &self,
        user_id: i32,
        title: &str,
        system_prompt: &str,
        kind: &str,
        now: &str,
    ) -> Result<TreeDetail, ServiceError> {
        let id: i64 = sqlx::query!(
            "INSERT INTO chat_tree (user_id, title, system_prompt, kind, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            user_id,
            title,
            system_prompt,
            kind,
            now
        )
        .execute(&self.pool)
        .await?
        .last_insert_rowid();

        Ok(TreeDetail {
            tree: TreeItem {
                id,
                title: title.to_string(),
                system_prompt: system_prompt.to_string(),
                kind: kind.to_string(),
                created_at: now.to_string(),
                updated_at: now.to_string(),
                node_count: 0,
            },
            nodes: Vec::new(),
        })
    }

    pub async fn update_tree(
        &self,
        user_id: i32,
        tree_id: i64,
        req: UpdateTreeRequest,
    ) -> Result<(), ServiceError> {
        let exists: Option<i64> = sqlx::query_scalar!(
            "SELECT id FROM chat_tree WHERE id = ?1 AND user_id = ?2",
            tree_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        if exists.is_none() {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        }

        if let Some(title) = req.title {
            if title.trim().is_empty() {
                return Err(ServiceError::InvalidInput("标题不能为空".into()));
            }
            sqlx::query!(
                "UPDATE chat_tree SET title = ?1, updated_at = datetime('now') WHERE id = ?2",
                title.trim(),
                tree_id
            )
            .execute(&self.pool)
            .await?;
        }
        if let Some(prompt) = req.system_prompt {
            sqlx::query!(
                "UPDATE chat_tree SET system_prompt = ?1, updated_at = datetime('now') WHERE id = ?2",
                prompt.trim(),
                tree_id
            )
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn delete_tree(&self, user_id: i32, tree_id: i64) -> Result<(), ServiceError> {
        let result = sqlx::query!(
            "DELETE FROM chat_tree WHERE id = ?1 AND user_id = ?2",
            tree_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        }
        sqlx::query!("DELETE FROM chat_node WHERE tree_id = ?1", tree_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn fetch_node(&self, node_id: i64) -> Result<Option<NodeItem>, ServiceError> {
        let row: Option<NodeRow> = sqlx::query_as!(
            NodeRow,
            r#"SELECT id, tree_id, parent_id, role, content, revised_from, reasoning,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM chat_node WHERE id = ?1"#,
            node_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(Into::into))
    }

    pub async fn insert_node(
        &self,
        tree_id: i64,
        parent_id: Option<i64>,
        role: &str,
        content: &str,
        revised_from: Option<i64>,
        reasoning: Option<&str>,
    ) -> Result<NodeItem, ServiceError> {
        let result = sqlx::query!(
            "INSERT INTO chat_node (tree_id, parent_id, role, content, revised_from, reasoning) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            tree_id,
            parent_id,
            role,
            content,
            revised_from,
            reasoning
        )
        .execute(&self.pool)
        .await?;
        self.fetch_node(result.last_insert_rowid())
            .await?
            .ok_or(ServiceError::Internal("节点写入失败".into()))
    }

    pub async fn fetch_tree_prompt(
        &self,
        user_id: i32,
        tree_id: i64,
    ) -> Result<Option<String>, ServiceError> {
        let tree: Option<TreePromptRow> = sqlx::query_as!(
            TreePromptRow,
            "SELECT system_prompt FROM chat_tree WHERE id = ?1 AND user_id = ?2",
            tree_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(tree.map(|t| t.system_prompt))
    }

    pub async fn update_tree_timestamp(&self, tree_id: i64) {
        let _ = sqlx::query!(
            "UPDATE chat_tree SET updated_at = datetime('now') WHERE id = ?1",
            tree_id
        )
        .execute(&self.pool)
        .await;
    }

    pub async fn delete_node(&self, node_id: i64) {
        let _ = sqlx::query!("DELETE FROM chat_node WHERE id = ?1", node_id)
            .execute(&self.pool)
            .await;
    }

    pub async fn fetch_tree_user_id(&self, tree_id: i64) -> Result<Option<i64>, ServiceError> {
        let id: Option<i64> =
            sqlx::query_scalar!("SELECT user_id FROM chat_tree WHERE id = ?1", tree_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(id)
    }

    pub async fn list_presets(&self, user_id: i32) -> Result<Vec<PresetItem>, ServiceError> {
        let rows: Vec<PresetRow> = sqlx::query_as!(
            PresetRow,
            r#"SELECT id, name, content,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM prompt_preset WHERE user_id = ?1 ORDER BY id"#,
            user_id
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Into::into).collect())
    }

    pub async fn create_preset(
        &self,
        user_id: i32,
        name: &str,
        content: &str,
    ) -> Result<PresetItem, ServiceError> {
        let id: i64 = sqlx::query!(
            "INSERT INTO prompt_preset (user_id, name, content) VALUES (?1, ?2, ?3)",
            user_id,
            name.trim(),
            content.trim()
        )
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        let row = sqlx::query_as!(
            PresetRow,
            r#"SELECT id, name, content,
                      COALESCE(created_at, '') AS "created_at!: String"
               FROM prompt_preset WHERE id = ?1"#,
            id
        )
        .fetch_one(&self.pool)
        .await?;
        Ok(row.into())
    }

    pub async fn update_preset(
        &self,
        user_id: i32,
        id: i64,
        name: &str,
        content: &str,
    ) -> Result<(), ServiceError> {
        let result = sqlx::query!(
            "UPDATE prompt_preset SET name = ?1, content = ?2 WHERE id = ?3 AND user_id = ?4",
            name.trim(),
            content.trim(),
            id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("预设不存在".into()));
        }
        Ok(())
    }

    pub async fn delete_preset(&self, user_id: i32, id: i64) -> Result<(), ServiceError> {
        let result = sqlx::query!(
            "DELETE FROM prompt_preset WHERE id = ?1 AND user_id = ?2",
            id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("预设不存在".into()));
        }
        Ok(())
    }

    pub async fn search(
        &self,
        user_id: i32,
        q: &str,
        limit: i64,
    ) -> Result<SearchResponse, ServiceError> {
        let kw = like_contains(q.trim());
        let limit = limit.clamp(1, 100);

        let node_hits: Vec<NodeHitRow> = sqlx::query_as!(
            NodeHitRow,
            r#"SELECT n.tree_id, t.title AS tree_title, n.id AS node_id, n.role, n.content,
                      COALESCE(n.created_at, CURRENT_TIMESTAMP) AS "created_at!: String"
               FROM chat_node n
               JOIN chat_tree t ON t.id = n.tree_id
               WHERE t.user_id = ?1 AND n.content LIKE ?2 ESCAPE '\'
               ORDER BY n.id DESC LIMIT ?3"#,
            user_id,
            kw,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        let mut hits: Vec<super::model::SearchHit> = node_hits
            .into_iter()
            .map(|r| super::model::SearchHit {
                tree_id: r.tree_id,
                tree_title: r.tree_title,
                node_id: Some(r.node_id),
                role: r.role,
                snippet: crate::shared::search::snippet_with_width(&r.content, q.trim(), 60),
                created_at: r.created_at,
            })
            .collect();

        if (hits.len() as i64) < limit {
            let title_hits: Vec<TitleHitRow> = sqlx::query_as!(
                TitleHitRow,
                r#"SELECT id AS tree_id, title AS tree_title,
                          COALESCE(updated_at, CURRENT_TIMESTAMP) AS "updated_at!: String"
                   FROM chat_tree
                   WHERE user_id = ?1 AND title LIKE ?2 ESCAPE '\'
                   ORDER BY updated_at DESC LIMIT ?3"#,
                user_id,
                kw,
                limit - hits.len() as i64
            )
            .fetch_all(&self.pool)
            .await?;

            for r in title_hits {
                if hits.iter().any(|h| h.tree_id == r.tree_id) {
                    continue;
                }
                hits.push(super::model::SearchHit {
                    tree_id: r.tree_id,
                    tree_title: r.tree_title.clone(),
                    node_id: None,
                    role: "tree".into(),
                    snippet: format!("【标题】{}", r.tree_title),
                    created_at: r.updated_at,
                });
            }
        }

        Ok(SearchResponse { hits })
    }

    pub async fn search_hits(
        &self,
        user_id: i32,
        like: &str,
        cap: i64,
    ) -> Result<Vec<GlobalSearchHit>, ServiceError> {
        let title_hits: Vec<GlobalChatTitleHitRow> = sqlx::query_as!(
            GlobalChatTitleHitRow,
            r#"SELECT id, title FROM chat_tree
               WHERE (user_id = ?1 OR user_id IS NULL) AND title LIKE ?2 ESCAPE '\'
               ORDER BY id DESC LIMIT ?3"#,
            user_id,
            like,
            cap
        )
        .fetch_all(&self.pool)
        .await?;

        let node_cap = cap - title_hits.len() as i64;
        let node_hits: Vec<GlobalChatNodeHitRow> = sqlx::query_as!(
            GlobalChatNodeHitRow,
            r#"SELECT n.id AS node_id, t.id AS tree_id, t.title, n.content
               FROM chat_node n JOIN chat_tree t ON t.id = n.tree_id
               WHERE (t.user_id = ?1 OR t.user_id IS NULL) AND n.content LIKE ?2 ESCAPE '\'
               ORDER BY n.id DESC LIMIT ?3"#,
            user_id,
            like,
            node_cap
        )
        .fetch_all(&self.pool)
        .await?;

        let mut hits: Vec<GlobalSearchHit> = title_hits
            .into_iter()
            .map(|r| GlobalSearchHit {
                kind: "chat".into(),
                id: r.id,
                title: r.title,
                snippet: String::new(),
                target: SearchTarget::ChatTree { tree_id: r.id },
            })
            .collect();
        hits.extend(node_hits.into_iter().map(|r| GlobalSearchHit {
            kind: "chat".into(),
            id: r.tree_id,
            title: r.title,
            snippet: snippet(&r.content, ""),
            target: SearchTarget::ChatNode {
                tree_id: r.tree_id,
                node_id: r.node_id,
            },
        }));
        Ok(hits)
    }
}
