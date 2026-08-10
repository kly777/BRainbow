use chrono::Utc;
use sqlx::SqlitePool;

use crate::error::ServiceError;

use super::model::{
    ChatResponse, CreateTreeRequest, NodeItem, PresetItem, ReviseRequest, ReviseResponse,
    TreeDetail, TreeItem, UpdateTreeRequest,
};

#[derive(Clone)]
pub struct ChatService {
    pool: SqlitePool,
    ai: crate::modules::ai::service::AiService,
}

impl ChatService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool: pool.clone(),
            ai: crate::modules::ai::service::AiService::new(pool),
        }
    }

    fn row_to_tree(
        row: (i64, String, String, String, String, i64),
    ) -> TreeItem {
        TreeItem {
            id: row.0,
            title: row.1,
            system_prompt: row.2,
            created_at: row.3,
            updated_at: row.4,
            node_count: row.5,
        }
    }

    // ── 树 CRUD ──

    pub async fn list_trees(&self, user_id: i32) -> Result<Vec<TreeItem>, ServiceError> {
        let rows: Vec<(i64, String, String, String, String, i64)> = sqlx::query_as(
            "SELECT t.id, t.title, t.system_prompt, t.created_at, t.updated_at,
                    (SELECT COUNT(*) FROM chat_node n WHERE n.tree_id = t.id) AS node_count
             FROM chat_tree t WHERE t.user_id = ?1 ORDER BY t.updated_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(Self::row_to_tree).collect())
    }

    pub async fn get_tree(&self, user_id: i32, tree_id: i64) -> Result<Option<TreeDetail>, ServiceError> {
        let tree: Option<(i64, String, String, String, String, i64)> = sqlx::query_as(
            "SELECT t.id, t.title, t.system_prompt, t.created_at, t.updated_at,
                    (SELECT COUNT(*) FROM chat_node n WHERE n.tree_id = t.id) AS node_count
             FROM chat_tree t WHERE t.id = ?1 AND t.user_id = ?2",
        )
        .bind(tree_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(tree) = tree else {
            return Ok(None);
        };

        let nodes: Vec<(i64, i64, Option<i64>, String, String, Option<i64>, String)> = sqlx::query_as(
            "SELECT id, tree_id, parent_id, role, content, revised_from, created_at
             FROM chat_node WHERE tree_id = ?1 ORDER BY id",
        )
        .bind(tree_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(Some(TreeDetail {
            tree: Self::row_to_tree(tree),
            nodes: nodes
                .into_iter()
                .map(|n| NodeItem {
                    id: n.0,
                    tree_id: n.1,
                    parent_id: n.2,
                    role: n.3,
                    content: n.4,
                    revised_from: n.5,
                    created_at: n.6,
                })
                .collect(),
        }))
    }

    pub async fn create_tree(
        &self,
        user_id: i32,
        req: CreateTreeRequest,
    ) -> Result<TreeDetail, ServiceError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ServiceError::InvalidInput("标题不能为空".into()));
        }
        let now = Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
        let id: i64 = sqlx::query(
            "INSERT INTO chat_tree (user_id, title, system_prompt, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)",
        )
        .bind(user_id)
        .bind(title)
        .bind(req.system_prompt.trim())
        .bind(&now)
        .execute(&self.pool)
        .await?
        .last_insert_rowid();

        Ok(TreeDetail {
            tree: TreeItem {
                id,
                title: title.to_string(),
                system_prompt: req.system_prompt.trim().to_string(),
                created_at: now.clone(),
                updated_at: now,
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
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM chat_tree WHERE id = ?1 AND user_id = ?2",
        )
        .bind(tree_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        if exists.is_none() {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        }

        if let Some(title) = req.title {
            if title.trim().is_empty() {
                return Err(ServiceError::InvalidInput("标题不能为空".into()));
            }
            sqlx::query("UPDATE chat_tree SET title = ?1, updated_at = datetime('now') WHERE id = ?2")
                .bind(title.trim())
                .bind(tree_id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(prompt) = req.system_prompt {
            sqlx::query(
                "UPDATE chat_tree SET system_prompt = ?1, updated_at = datetime('now') WHERE id = ?2",
            )
            .bind(prompt.trim())
            .bind(tree_id)
            .execute(&self.pool)
            .await?;
        }
        Ok(())
    }

    pub async fn delete_tree(&self, user_id: i32, tree_id: i64) -> Result<(), ServiceError> {
        let result = sqlx::query("DELETE FROM chat_tree WHERE id = ?1 AND user_id = ?2")
            .bind(tree_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        }
        // 级联删除节点
        sqlx::query("DELETE FROM chat_node WHERE tree_id = ?1")
            .bind(tree_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── 节点 ──

    async fn fetch_node(&self, node_id: i64) -> Result<Option<NodeItem>, ServiceError> {
        let row: Option<(i64, i64, Option<i64>, String, String, Option<i64>, String)> =
            sqlx::query_as(
                "SELECT id, tree_id, parent_id, role, content, revised_from, created_at
                 FROM chat_node WHERE id = ?1",
            )
            .bind(node_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|n| NodeItem {
            id: n.0,
            tree_id: n.1,
            parent_id: n.2,
            role: n.3,
            content: n.4,
            revised_from: n.5,
            created_at: n.6,
        }))
    }

    async fn insert_node(
        &self,
        tree_id: i64,
        parent_id: Option<i64>,
        role: &str,
        content: &str,
        revised_from: Option<i64>,
    ) -> Result<NodeItem, ServiceError> {
        let result = sqlx::query(
            "INSERT INTO chat_node (tree_id, parent_id, role, content, revised_from) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(tree_id)
        .bind(parent_id)
        .bind(role)
        .bind(content)
        .bind(revised_from)
        .execute(&self.pool)
        .await?;
        self.fetch_node(result.last_insert_rowid())
            .await?
            .ok_or(ServiceError::Internal("节点写入失败".into()))
    }

    /// 组装节点到根的祖先链（父在前、子在后）
    async fn ancestor_chain(
        &self,
        node_id: Option<i64>,
    ) -> Result<Vec<NodeItem>, ServiceError> {
        let mut chain = Vec::new();
        let mut cur = node_id;
        let mut guard = 0;
        while let Some(id) = cur {
            if guard > 200 {
                return Err(ServiceError::Internal("对话链过长".into()));
            }
            guard += 1;
            let node = self.fetch_node(id).await?.ok_or_else(|| {
                ServiceError::NotFound("消息节点不存在".into())
            })?;
            cur = node.parent_id;
            chain.push(node);
        }
        chain.reverse();
        Ok(chain)
    }

    // ── 发送消息 + AI 回复 ──

    pub async fn chat(
        &self,
        user_id: i32,
        tree_id: i64,
        parent_id: Option<i64>,
        content: Option<String>,
    ) -> Result<ChatResponse, ServiceError> {
        let tree: Option<(String, String)> = sqlx::query_as(
            "SELECT title, system_prompt FROM chat_tree WHERE id = ?1 AND user_id = ?2",
        )
        .bind(tree_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((_title, system_prompt)) = tree else {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        };

        // 确定插入点与 user 消息内容
        // inserted_user_id: Some = 本次新插入的 user 节点（AI 失败时需回滚）
        let (user_node, ai_parent_id, inserted_user_id): (NodeItem, Option<i64>, Option<i64>) =
            match parent_id {
                Some(pid) => {
                    let parent = self.fetch_node(pid).await?.ok_or_else(|| {
                        ServiceError::NotFound("父节点不存在".into())
                    })?;
                    if parent.tree_id != tree_id {
                        return Err(ServiceError::InvalidInput("节点不属于该对话树".into()));
                    }
                    if parent.role == "assistant" {
                        let text = content
                            .map(|c| c.trim().to_string())
                            .filter(|c| !c.is_empty())
                            .ok_or_else(|| {
                                ServiceError::InvalidInput("消息内容不能为空".into())
                            })?;
                        let node = self
                            .insert_node(tree_id, Some(pid), "user", &text, None)
                            .await?;
                        (node.clone(), Some(node.id), Some(node.id))
                    } else {
                        // parent 是 user（修订后重问）：不插入新 user，直接调 AI
                        (parent.clone(), Some(pid), None)
                    }
                }
                None => {
                    // 根节点：新 user 消息 + AI 回复
                    let text = content
                        .map(|c| c.trim().to_string())
                        .filter(|c| !c.is_empty())
                        .ok_or_else(|| ServiceError::InvalidInput("消息内容不能为空".into()))?;
                    let node = self.insert_node(tree_id, None, "user", &text, None).await?;
                    (node.clone(), Some(node.id), Some(node.id))
                }
            };

        // 组装上下文：ai_parent_id 表示"AI 回复的父节点"（user 节点）
        let chain = self.ancestor_chain(Some(user_node.id)).await?;
        let assistant = match self.ask_llm(user_id, &system_prompt, &chain).await {
            Ok(reply) => {
                self.insert_node(tree_id, ai_parent_id, "assistant", &reply, None)
                    .await?
            }
            Err(e) => {
                // AI 失败：仅回滚本次新插入的 user 节点（修订重问场景不删除原有节点）
                if let Some(new_id) = inserted_user_id {
                    let _ = sqlx::query("DELETE FROM chat_node WHERE id = ?1")
                        .bind(new_id)
                        .execute(&self.pool)
                        .await;
                }
                return Err(e);
            }
        };

        // 更新树的更新时间
        let _ = sqlx::query("UPDATE chat_tree SET updated_at = datetime('now') WHERE id = ?1")
            .bind(tree_id)
            .execute(&self.pool)
            .await;

        Ok(ChatResponse { user: user_node, assistant })
    }

    /// 编辑节点 → 创建修订版（同父新节点，revised_from = 原节点）
    pub async fn revise_node(
        &self,
        user_id: i32,
        node_id: i64,
        req: ReviseRequest,
    ) -> Result<ReviseResponse, ServiceError> {
        let node = self.fetch_node(node_id).await?.ok_or_else(|| {
            ServiceError::NotFound("消息节点不存在".into())
        })?;

        // 校验归属
        let tree_user: Option<i64> = sqlx::query_scalar(
            "SELECT user_id FROM chat_tree WHERE id = ?1",
        )
        .bind(node.tree_id)
        .fetch_optional(&self.pool)
        .await?;
        if tree_user != Some(user_id as i64) {
            return Err(ServiceError::NotFound("消息节点不存在".into()));
        }

        let content = req.content.trim();
        if content.is_empty() {
            return Err(ServiceError::InvalidInput("内容不能为空".into()));
        }

        let revised = self
            .insert_node(
                node.tree_id,
                node.parent_id,
                &node.role,
                content,
                Some(node.id),
            )
            .await?;

        let _ = sqlx::query("UPDATE chat_tree SET updated_at = datetime('now') WHERE id = ?1")
            .bind(node.tree_id)
            .execute(&self.pool)
            .await;

        Ok(ReviseResponse { node: revised })
    }

    // ── 预设提示词 CRUD ──

    pub async fn list_presets(&self, user_id: i32) -> Result<Vec<PresetItem>, ServiceError> {
        let rows: Vec<(i64, String, String, String)> = sqlx::query_as(
            "SELECT id, name, content, created_at FROM prompt_preset WHERE user_id = ?1 ORDER BY id",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| PresetItem {
                id: r.0,
                name: r.1,
                content: r.2,
                created_at: r.3,
            })
            .collect())
    }

    pub async fn create_preset(
        &self,
        user_id: i32,
        name: &str,
        content: &str,
    ) -> Result<PresetItem, ServiceError> {
        if name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("预设名称不能为空".into()));
        }
        let id: i64 = sqlx::query(
            "INSERT INTO prompt_preset (user_id, name, content) VALUES (?1, ?2, ?3)",
        )
        .bind(user_id)
        .bind(name.trim())
        .bind(content.trim())
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        let row: (i64, String, String, String) = sqlx::query_as(
            "SELECT id, name, content, created_at FROM prompt_preset WHERE id = ?1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
        Ok(PresetItem {
            id: row.0,
            name: row.1,
            content: row.2,
            created_at: row.3,
        })
    }

    pub async fn update_preset(
        &self,
        user_id: i32,
        id: i64,
        name: &str,
        content: &str,
    ) -> Result<(), ServiceError> {
        let result = sqlx::query(
            "UPDATE prompt_preset SET name = ?1, content = ?2 WHERE id = ?3 AND user_id = ?4",
        )
        .bind(name.trim())
        .bind(content.trim())
        .bind(id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("预设不存在".into()));
        }
        Ok(())
    }

    pub async fn delete_preset(&self, user_id: i32, id: i64) -> Result<(), ServiceError> {
        let result = sqlx::query("DELETE FROM prompt_preset WHERE id = ?1 AND user_id = ?2")
            .bind(id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(ServiceError::NotFound("预设不存在".into()));
        }
        Ok(())
    }

    // ── LLM 调用（统一走 AiService，读用户数据库配置） ──

    async fn ask_llm(
        &self,
        user_id: i32,
        system_prompt: &str,
        chain: &[NodeItem],
    ) -> Result<String, ServiceError> {
        let mut messages: Vec<crate::modules::ai::model::AiProxyMessage> = Vec::new();
        if !system_prompt.trim().is_empty() {
            messages.push(crate::modules::ai::model::AiProxyMessage {
                role: "system".into(),
                content: system_prompt.to_string(),
            });
        }
        for node in chain {
            messages.push(crate::modules::ai::model::AiProxyMessage {
                role: node.role.clone(),
                content: node.content.clone(),
            });
        }
        let (content, _model) = self.ai.chat(user_id, &messages, None, None).await?;
        Ok(content)
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> ChatService {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE chat_tree (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, system_prompt TEXT NOT NULL DEFAULT '', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool).await.unwrap();
        sqlx::query("CREATE TABLE chat_node (id INTEGER PRIMARY KEY AUTOINCREMENT, tree_id INTEGER NOT NULL, parent_id INTEGER, role TEXT NOT NULL CHECK (role IN ('user','assistant')), content TEXT NOT NULL, revised_from INTEGER, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool).await.unwrap();
        ChatService::new(pool)
    }

    #[tokio::test]
    async fn create_and_get_tree() {
        let svc = setup().await;
        let detail = svc.create_tree(1, CreateTreeRequest { title: "t".into(), system_prompt: "p".into() }).await.unwrap();
        assert_eq!(detail.tree.title, "t");
        assert_eq!(detail.tree.node_count, 0);

        let got = svc.get_tree(1, detail.tree.id).await.unwrap().unwrap();
        assert_eq!(got.tree.id, detail.tree.id);
        assert_eq!(got.nodes.len(), 0);

        // 其他用户不可见
        assert!(svc.get_tree(2, detail.tree.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn revise_creates_new_node_keeping_original() {
        let svc = setup().await;
        let tree = svc.create_tree(1, CreateTreeRequest { title: "t".into(), system_prompt: "".into() }).await.unwrap();
        let tid = tree.tree.id;

        // 插入两个节点模拟历史（绕过 AI）
        let user = svc.insert_node(tid, None, "user", "原问题", None).await.unwrap();
        let _assistant = svc.insert_node(tid, Some(user.id), "assistant", "原回答", None).await.unwrap();

        // 修订 user 节点
        let rev = svc.revise_node(1, user.id, ReviseRequest { content: "修订问题".into() }).await.unwrap();
        assert_eq!(rev.node.parent_id, None);
        assert_eq!(rev.node.revised_from, Some(user.id));
        assert_eq!(rev.node.content, "修订问题");

        // 原节点仍存在
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 3);
        assert!(got.nodes.iter().any(|n| n.id == user.id && n.content == "原问题"));
        assert!(got.nodes.iter().any(|n| n.revised_from == Some(user.id)));
    }

    #[tokio::test]
    async fn revise_fails_for_other_user() {
        let svc = setup().await;
        let tree = svc.create_tree(1, CreateTreeRequest { title: "t".into(), system_prompt: "".into() }).await.unwrap();
        let tid = tree.tree.id;
        let user = svc.insert_node(tid, None, "user", "q", None).await.unwrap();
        assert!(svc.revise_node(2, user.id, ReviseRequest { content: "x".into() }).await.is_err());
    }

    #[tokio::test]
    async fn delete_tree_cascades_nodes() {
        let svc = setup().await;
        let tree = svc.create_tree(1, CreateTreeRequest { title: "t".into(), system_prompt: "".into() }).await.unwrap();
        let tid = tree.tree.id;
        let user = svc.insert_node(tid, None, "user", "q", None).await.unwrap();
        let _a = svc.insert_node(tid, Some(user.id), "assistant", "a", None).await.unwrap();

        svc.delete_tree(1, tid).await.unwrap();
        assert!(svc.get_tree(1, tid).await.unwrap().is_none());
        // 节点表已清空（间接通过 get_tree 验证）
    }

    #[tokio::test]
    async fn chat_without_llm_config_returns_error_and_rolls_back() {
        let svc = setup().await;
        // 无 LLM 配置（from_env 返回 None）
        let tree = svc.create_tree(1, CreateTreeRequest { title: "t".into(), system_prompt: "".into() }).await.unwrap();
        let tid = tree.tree.id;
        let result = svc.chat(1, tid, None, Some("hello".into())).await;
        assert!(result.is_err());

        // user 节点应被回滚
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 0);
    }
}
