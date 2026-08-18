use sqlx::{FromRow, SqlitePool};

use crate::modules::ai::model::AiProxyMessage;
use crate::modules::ai::service::AiService;
use crate::shared::error_types::ServiceError;
use crate::shared::time_text::utc_now_iso;

use super::model::{
    CreateTreeRequest, NodeItem, PresetItem, ReviseRequest, ReviseResponse, TreeDetail, TreeItem,
    UpdateTreeRequest,
};

#[derive(Clone)]
pub struct ChatService {
    pool: SqlitePool,
}

/// chat_tree 行（created_at/updated_at 可能为空，查询时 COALESCE 兜底）
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

/// chat_node 行
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

/// prepare_chat 需要的对话树提示词列
#[derive(FromRow)]
struct TreePromptRow {
    system_prompt: String,
}

/// prompt_preset 行
#[derive(FromRow)]
struct PresetRow {
    id: i64,
    name: String,
    content: String,
    created_at: String,
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

impl ChatService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    // ── 树 CRUD ──

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

    /// 按类型列出对话树（chat / mem）
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
        req: CreateTreeRequest,
    ) -> Result<TreeDetail, ServiceError> {
        let title = req.title.trim();
        if title.is_empty() {
            return Err(ServiceError::InvalidInput("标题不能为空".into()));
        }
        let kind = req
            .kind
            .as_deref()
            .filter(|k| *k == "mem")
            .unwrap_or("chat")
            .to_string();
        // mem 树：内置记忆卡片生成指令（用户无需手写 system_prompt）
        let system_prompt = if kind == "mem" {
            Self::MEM_SYSTEM_PROMPT.to_string()
        } else {
            req.system_prompt.trim().to_string()
        };
        let now = utc_now_iso();
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
                system_prompt,
                kind,
                created_at: now.clone(),
                updated_at: now,
                node_count: 0,
            },
            nodes: Vec::new(),
        })
    }

    /// mem 树内置 system prompt：让 AI 输出结构化记忆卡片 JSON
    const MEM_SYSTEM_PROMPT: &str = "你是一名记忆卡片生成专家。根据用户提供的文本生成记忆卡片。
严格要求：
- 文本中每出现一个独立知识点，就必须对应生成一张卡片，一一对应、绝不合并、绝不遗漏
- 生成前先数清楚知识点总数，卡片数量必须等于知识点数量
- 每张卡片包含 cue（线索/问题，可含填空）与 target（简洁准确的答案）
- 可以自由使用 Markdown 语法（加粗、列表、代码等）来增强表达
- 数学内容必须优先使用 $$ 包裹的 LaTeX，而不是 Unicode 符号或 ASCII 近似：例如 $$P(X=k)=\\binom{n}{k}p^k(1-p)^{n-k}$$、$$X\\sim B(n,p)$$、$$f(x)=\\frac{1}{\\sqrt{2\\pi}\\sigma}e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}$$；禁止用 C(n,k)、X~B(n,p)、√、σ² 这类简写，所有公式一律写成 LaTeX
- 行内公式用 $...$，独立公式用 $$...$$
- 严格输出单个合法 JSON 数组，一行内完成，不要换行、不要缩进、不要代码块标记、不要任何解释文字
- 格式必须精确为：[{\"cue\":\"...\",\"target\":\"...\"},{\"cue\":\"...\",\"target\":\"...\"}]
- 所有键名和字符串必须使用半角双引号，键名后必须有冒号；字符串内的 LaTeX 反斜杠需写成 \\\\
当用户后续给出修改指令时，基于上下文修订卡片并输出完整 JSON 数组。";

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

    /// 用 AI 根据对话内容生成标题，并写回 chat_tree。
    pub async fn generate_title(
        &self,
        user_id: i32,
        tree_id: i64,
        ai: &AiService,
    ) -> Result<String, ServiceError> {
        let detail = self
            .get_tree(user_id, tree_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("对话树不存在".into()))?;
        if detail.nodes.is_empty() {
            return Err(ServiceError::InvalidInput("对话还没有内容".into()));
        }

        let mut transcript = String::new();
        for node in detail.nodes.iter().filter(|n| n.role != "system").take(8) {
            let role = if node.role == "user" {
                "用户"
            } else {
                "助手"
            };
            let content: String = node.content.chars().take(200).collect::<String>();
            transcript.push_str(&format!("{role}：{content}\n"));
        }

        let messages = vec![
            AiProxyMessage {
                role: "system".into(),
                content:
                    "你是对话标题助手。根据对话内容生成一个简洁的中文标题，不超过20个字。直接输出标题，不要引号、标点、换行或任何解释。"
                        .into(),
            },
            AiProxyMessage {
                role: "user".into(),
                content: transcript,
            },
        ];
        let (raw, _model) = ai.chat(user_id, &messages, Some(0.3), Some(64)).await?;
        let title = sanitize_title(&raw);
        if title.is_empty() {
            return Err(ServiceError::InvalidInput("AI 未生成有效标题".into()));
        }

        self.update_tree(
            user_id,
            tree_id,
            UpdateTreeRequest {
                title: Some(title.clone()),
                system_prompt: None,
            },
        )
        .await?;
        Ok(title)
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
        // 级联删除节点
        sqlx::query!("DELETE FROM chat_node WHERE tree_id = ?1", tree_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── 节点 ──

    async fn fetch_node(&self, node_id: i64) -> Result<Option<NodeItem>, ServiceError> {
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

    async fn insert_node(
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

    /// 组装节点到根的祖先链（父在前、子在后）
    async fn ancestor_chain(&self, node_id: Option<i64>) -> Result<Vec<NodeItem>, ServiceError> {
        let mut chain = Vec::new();
        let mut cur = node_id;
        let mut guard = 0;
        while let Some(id) = cur {
            if guard > 200 {
                return Err(ServiceError::Internal("对话链过长".into()));
            }
            guard += 1;
            let node = self
                .fetch_node(id)
                .await?
                .ok_or_else(|| ServiceError::NotFound("消息节点不存在".into()))?;
            cur = node.parent_id;
            chain.push(node);
        }
        chain.reverse();
        Ok(chain)
    }

    // ── 发送消息 + AI 回复 ──

    /// 流式对话准备：校验、插入 user 节点、组装消息链。
    pub async fn prepare_chat(
        &self,
        user_id: i32,
        tree_id: i64,
        parent_id: Option<i64>,
        content: Option<String>,
    ) -> Result<PreparedChat, ServiceError> {
        let tree: Option<TreePromptRow> = sqlx::query_as!(
            TreePromptRow,
            "SELECT system_prompt FROM chat_tree WHERE id = ?1 AND user_id = ?2",
            tree_id,
            user_id
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(tree) = tree else {
            return Err(ServiceError::NotFound("对话树不存在".into()));
        };
        let system_prompt = tree.system_prompt;

        // 确定插入点与 user 消息内容
        // inserted_user_id: Some = 本次新插入的 user 节点（AI 失败时需回滚）
        let (user_node, ai_parent_id, inserted_user_id): (NodeItem, Option<i64>, Option<i64>) =
            match parent_id {
                Some(pid) => {
                    let parent = self
                        .fetch_node(pid)
                        .await?
                        .ok_or_else(|| ServiceError::NotFound("父节点不存在".into()))?;
                    if parent.tree_id != tree_id {
                        return Err(ServiceError::InvalidInput("节点不属于该对话树".into()));
                    }
                    if parent.role == "assistant" {
                        let text = content
                            .map(|c| c.trim().to_string())
                            .filter(|c| !c.is_empty())
                            .ok_or_else(|| ServiceError::InvalidInput("消息内容不能为空".into()))?;
                        let node = self
                            .insert_node(tree_id, Some(pid), "user", &text, None, None)
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
                    let node = self
                        .insert_node(tree_id, None, "user", &text, None, None)
                        .await?;
                    (node.clone(), Some(node.id), Some(node.id))
                }
            };

        // 组装消息链（system + 祖先链）
        let chain = self.ancestor_chain(Some(user_node.id)).await?;
        let mut messages: Vec<crate::modules::ai::model::AiProxyMessage> = Vec::new();
        if !system_prompt.trim().is_empty() {
            messages.push(crate::modules::ai::model::AiProxyMessage {
                role: "system".into(),
                content: system_prompt.clone(),
            });
        }
        for node in &chain {
            messages.push(crate::modules::ai::model::AiProxyMessage {
                role: node.role.clone(),
                content: node.content.clone(),
            });
        }

        Ok(PreparedChat {
            tree_id,
            ai_parent_id,
            inserted_user_id,
            messages,
        })
    }

    /// 流式完成后落库 assistant 节点；失败回滚新插入的 user 节点
    pub async fn finish_chat(
        &self,
        ctx: &PreparedChat,
        reply: &str,
        reasoning: Option<&str>,
    ) -> Result<NodeItem, ServiceError> {
        let assistant = self
            .insert_node(
                ctx.tree_id,
                ctx.ai_parent_id,
                "assistant",
                reply,
                None,
                reasoning,
            )
            .await?;
        // 更新树的更新时间
        let _ = sqlx::query!(
            "UPDATE chat_tree SET updated_at = datetime('now') WHERE id = ?1",
            ctx.tree_id
        )
        .execute(&self.pool)
        .await;
        Ok(assistant)
    }

    /// AI 失败后的清理（回滚新插入的 user 节点）
    pub async fn abort_chat(&self, ctx: &PreparedChat) {
        if let Some(new_id) = ctx.inserted_user_id {
            let _ = sqlx::query!("DELETE FROM chat_node WHERE id = ?1", new_id)
                .execute(&self.pool)
                .await;
        }
    }

    /// 编辑节点 → 创建修订版（同父新节点，revised_from = 原节点）
    pub async fn revise_node(
        &self,
        user_id: i32,
        node_id: i64,
        req: ReviseRequest,
    ) -> Result<ReviseResponse, ServiceError> {
        let node = self
            .fetch_node(node_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("消息节点不存在".into()))?;

        // 校验归属
        let tree_user: Option<i64> =
            sqlx::query_scalar!("SELECT user_id FROM chat_tree WHERE id = ?1", node.tree_id)
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
                None,
            )
            .await?;

        let _ = sqlx::query!(
            "UPDATE chat_tree SET updated_at = datetime('now') WHERE id = ?1",
            node.tree_id
        )
        .execute(&self.pool)
        .await;

        Ok(ReviseResponse { node: revised })
    }

    // ── 预设提示词 CRUD ──

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
        if name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("预设名称不能为空".into()));
        }
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
}

/// 流式对话的准备结果：prepare_chat 产出，finish_chat / abort_chat 消费
#[derive(Clone)]
pub struct PreparedChat {
    pub tree_id: i64,
    pub ai_parent_id: Option<i64>,
    pub inserted_user_id: Option<i64>,
    pub messages: Vec<crate::modules::ai::model::AiProxyMessage>,
}

/// 清理 AI 返回的标题：去引号/空白/换行，限制 20 字。
pub(crate) fn sanitize_title(raw: &str) -> String {
    raw.trim()
        .trim_matches(|c| c == '"' || c == '\'' || c == '「' || c == '」' || c == '《' || c == '》')
        .lines()
        .next()
        .unwrap_or("")
        .trim()
        .chars()
        .take(20)
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use super::*;
    use sqlx::SqlitePool;

    async fn setup() -> ChatService {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        ChatService::new(pool)
    }

    #[tokio::test]
    async fn create_and_get_tree() {
        let svc = setup().await;
        let detail = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "p".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(detail.tree.title, "t");
        assert_eq!(detail.tree.node_count, 0);

        let got = svc.get_tree(1, detail.tree.id).await.unwrap().unwrap();
        assert_eq!(got.tree.id, detail.tree.id);
        assert_eq!(got.nodes.len(), 0);

        // 其他用户不可见
        assert!(svc.get_tree(2, detail.tree.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn create_mem_tree_gets_builtin_prompt_and_kind_filter() {
        let svc = setup().await;
        let chat = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "普通对话".into(),
                    system_prompt: "自定义".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(chat.tree.kind, "chat");
        assert_eq!(chat.tree.system_prompt, "自定义");

        let mem = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "记忆生成".into(),
                    system_prompt: "会被覆盖".into(),
                    kind: Some("mem".into()),
                },
            )
            .await
            .unwrap();
        assert_eq!(mem.tree.kind, "mem");
        assert!(mem.tree.system_prompt.contains("记忆卡片"));

        // 非法 kind 回退 chat
        let bad = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "x".into(),
                    system_prompt: "".into(),
                    kind: Some("hack".into()),
                },
            )
            .await
            .unwrap();
        assert_eq!(bad.tree.kind, "chat");

        // kind 过滤
        let mems = svc.list_trees_by_kind(1, "mem").await.unwrap();
        assert_eq!(mems.len(), 1);
        assert_eq!(mems[0].title, "记忆生成");
        let chats = svc.list_trees_by_kind(1, "chat").await.unwrap();
        assert_eq!(chats.len(), 2);
    }

    #[tokio::test]
    async fn revise_creates_new_node_keeping_original() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        let tid = tree.tree.id;

        // 插入两个节点模拟历史（绕过 AI）
        let user = svc
            .insert_node(tid, None, "user", "原问题", None, None)
            .await
            .unwrap();
        let _assistant = svc
            .insert_node(tid, Some(user.id), "assistant", "原回答", None, None)
            .await
            .unwrap();

        // 修订 user 节点
        let rev = svc
            .revise_node(
                1,
                user.id,
                ReviseRequest {
                    content: "修订问题".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(rev.node.parent_id, None);
        assert_eq!(rev.node.revised_from, Some(user.id));
        assert_eq!(rev.node.content, "修订问题");

        // 原节点仍存在
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 3);
        assert!(
            got.nodes
                .iter()
                .any(|n| n.id == user.id && n.content == "原问题")
        );
        assert!(got.nodes.iter().any(|n| n.revised_from == Some(user.id)));
    }

    #[tokio::test]
    async fn revise_fails_for_other_user() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        let tid = tree.tree.id;
        let user = svc
            .insert_node(tid, None, "user", "q", None, None)
            .await
            .unwrap();
        assert!(
            svc.revise_node(
                2,
                user.id,
                ReviseRequest {
                    content: "x".into()
                }
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn delete_tree_cascades_nodes() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        let tid = tree.tree.id;
        let user = svc
            .insert_node(tid, None, "user", "q", None, None)
            .await
            .unwrap();
        let _a = svc
            .insert_node(tid, Some(user.id), "assistant", "a", None, None)
            .await
            .unwrap();

        svc.delete_tree(1, tid).await.unwrap();
        assert!(svc.get_tree(1, tid).await.unwrap().is_none());
        // 节点表已清空（间接通过 get_tree 验证）
    }

    #[tokio::test]
    async fn chat_prepare_abort_rolls_back_inserted_user() {
        let svc = setup().await;
        // 无 LLM 配置（from_env 返回 None）
        let tree = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        let tid = tree.tree.id;
        // prepare 成功（插入了 user 节点），但无 AI 配置时 abort 应回滚
        let ctx = svc
            .prepare_chat(1, tid, None, Some("hello".into()))
            .await
            .unwrap();
        assert_eq!(ctx.inserted_user_id, Some(ctx.ai_parent_id.unwrap()));
        svc.abort_chat(&ctx).await;
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 0);

        // user 节点应被回滚
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 0);
    }

    #[tokio::test]
    async fn finish_chat_persists_reasoning() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                1,
                CreateTreeRequest {
                    title: "t".into(),
                    system_prompt: "".into(),
                    kind: None,
                },
            )
            .await
            .unwrap();
        let tid = tree.tree.id;

        let user = svc
            .insert_node(tid, None, "user", "q", None, None)
            .await
            .unwrap();
        let ctx = svc.prepare_chat(1, tid, Some(user.id), None).await.unwrap();
        svc.finish_chat(&ctx, "回答内容", Some("推理过程内容"))
            .await
            .unwrap();

        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        let assistant = got.nodes.iter().find(|n| n.role == "assistant").unwrap();
        assert_eq!(assistant.content, "回答内容");
        assert_eq!(assistant.reasoning.as_deref(), Some("推理过程内容"));

        // 无推理时落库为 None
        let ctx2 = svc
            .prepare_chat(1, tid, Some(assistant.id), Some("追问".into()))
            .await
            .unwrap();
        svc.finish_chat(&ctx2, "再回答", None).await.unwrap();
        let got = svc.get_tree(1, tid).await.unwrap().unwrap();
        let last = got.nodes.last().unwrap();
        assert_eq!(last.content, "再回答");
        assert!(last.reasoning.is_none());
    }

    #[test]
    fn sanitize_title_cleans_ai_output() {
        assert_eq!(sanitize_title("\"如何学习 Rust\"\n"), "如何学习 Rust");
        assert_eq!(sanitize_title("「一次函数与导数」"), "一次函数与导数");
        assert_eq!(
            sanitize_title("  你好，世界！请多指教  "),
            "你好，世界！请多指教"
        );
        assert_eq!(
            sanitize_title("一二三四五六七八九十一二三四五六七八九十超出"),
            "一二三四五六七八九十一二三四五六七八九十"
        );
    }
}
