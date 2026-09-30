use sqlx::SqlitePool;

use crate::modules::ai::model::AiProxyMessage;
use crate::modules::ai::port::AiChatPort;

/// SSE 协议常量（前端 streamChatRequest.ts 保持一致）：流结束标记 / 错误前缀
pub const SSE_DONE: &str = "__DONE__";
pub const SSE_ERROR_PREFIX: &str = "__ERROR__:";
use crate::shared::actor::Actor;
use crate::shared::error_types::ServiceError;
use crate::shared::time_text::utc_now_iso;

use super::model::{
    CreateTreeRequest, NodeItem, PresetItem, ReviseRequest, ReviseResponse, TreeDetail, TreeItem,
    UpdateTreeRequest,
};
use super::repository::ChatRepo;

#[derive(Clone)]
pub struct ChatService {
    repo: ChatRepo,
}

impl ChatService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: ChatRepo::new(pool),
        }
    }

    // ── 树 CRUD ──

    pub async fn list_trees(&self, actor: &Actor) -> Result<Vec<TreeItem>, ServiceError> {
        self.repo.list_trees(actor).await
    }

    pub async fn list_trees_by_kind(
        &self,
        actor: &Actor,
        kind: &str,
    ) -> Result<Vec<TreeItem>, ServiceError> {
        self.repo.list_trees_by_kind(actor, kind).await
    }

    pub async fn get_tree(
        &self,
        actor: &Actor,
        tree_id: i64,
    ) -> Result<Option<TreeDetail>, ServiceError> {
        self.repo.get_tree(actor, tree_id).await
    }

    /// 子表随父：`chat_node` 没有 user_id，归属回到所属对话树判
    /// （判据在 `Actor`，这里只负责取归属；越权一律按"不存在"回）。
    ///
    /// `chat_tree.user_id` 是 NOT NULL，取回 `None` 只表示树不存在 —— 那种情况
    /// 对谁都按不存在处理（admin 也不该往一棵没了的树里写）。
    async fn ensure_tree_owned(&self, actor: &Actor, tree_id: i64) -> Result<(), ServiceError> {
        match self.repo.owner_of_tree(tree_id).await? {
            Some(owner) if actor.can_write(Some(owner)) => Ok(()),
            _ => Err(ServiceError::NotFound("对话树不存在".into())),
        }
    }

    /// 节点级写入口：先取节点（不看归属）→ 归属回到所属树 → `actor.can_write`
    async fn ensure_node_owned(
        &self,
        actor: &Actor,
        node_id: i64,
    ) -> Result<NodeItem, ServiceError> {
        let node = self
            .repo
            .fetch_node_unscoped(node_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("消息节点不存在".into()))?;
        match self.repo.owner_of_tree(node.tree_id).await? {
            Some(owner) if actor.can_write(Some(owner)) => Ok(node),
            _ => Err(ServiceError::NotFound("消息节点不存在".into())),
        }
    }

    pub async fn create_tree(
        &self,
        actor: &Actor,
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
        let system_prompt = if kind == "mem" {
            Self::MEM_SYSTEM_PROMPT.to_string()
        } else {
            req.system_prompt.trim().to_string()
        };
        let now = utc_now_iso();
        self.repo
            .create_tree(actor, title, &system_prompt, &kind, &now)
            .await
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
        actor: &Actor,
        tree_id: i64,
        req: UpdateTreeRequest,
    ) -> Result<(), ServiceError> {
        self.repo.update_tree(actor, tree_id, req).await
    }

    /// 用 AI 根据对话内容生成标题，并写回 chat_tree。
    pub async fn generate_title(
        &self,
        actor: &Actor,
        tree_id: i64,
        ai: &dyn AiChatPort,
    ) -> Result<String, ServiceError> {
        let detail = self
            .get_tree(actor, tree_id)
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
        let (raw, _model) = ai
            .chat(actor.user_id, &messages, Some(0.3), Some(64))
            .await?;
        let title = sanitize_title(&raw);
        if title.is_empty() {
            return Err(ServiceError::InvalidInput("AI 未生成有效标题".into()));
        }

        self.update_tree(
            actor,
            tree_id,
            UpdateTreeRequest {
                title: Some(title.clone()),
                system_prompt: None,
            },
        )
        .await?;
        Ok(title)
    }

    pub async fn delete_tree(&self, actor: &Actor, tree_id: i64) -> Result<(), ServiceError> {
        self.repo.delete_tree(actor, tree_id).await
    }

    // ── 节点 ──

    async fn fetch_node(
        &self,
        actor: &Actor,
        node_id: i64,
    ) -> Result<Option<NodeItem>, ServiceError> {
        self.repo.fetch_node(actor, node_id).await
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
        self.repo
            .insert_node(tree_id, parent_id, role, content, revised_from, reasoning)
            .await
    }

    /// 组装节点到根的祖先链（父在前、子在后）；链上每个节点都要在当前调用者可见的树里
    async fn ancestor_chain(
        &self,
        actor: &Actor,
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
            let node = self
                .fetch_node(actor, id)
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
        actor: &Actor,
        tree_id: i64,
        parent_id: Option<i64>,
        content: Option<String>,
    ) -> Result<PreparedChat, ServiceError> {
        // 写入口的归属闸门（下面读 system prompt 的那次查询也带同样条件，双保险）
        self.ensure_tree_owned(actor, tree_id).await?;
        let system_prompt = self
            .repo
            .fetch_tree_prompt(actor, tree_id)
            .await?
            .ok_or_else(|| ServiceError::NotFound("对话树不存在".into()))?;

        let (user_node, ai_parent_id, inserted_user_id): (NodeItem, Option<i64>, Option<i64>) =
            if let Some(pid) = parent_id {
                // 子表随父：父节点也得属于调用者（别人的节点按不存在回）
                let parent = self.ensure_node_owned(actor, pid).await?;
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
                    (parent.clone(), Some(pid), None)
                }
            } else {
                let text = content
                    .map(|c| c.trim().to_string())
                    .filter(|c| !c.is_empty())
                    .ok_or_else(|| ServiceError::InvalidInput("消息内容不能为空".into()))?;
                let node = self
                    .insert_node(tree_id, None, "user", &text, None, None)
                    .await?;
                (node.clone(), Some(node.id), Some(node.id))
            };

        let chain = self.ancestor_chain(actor, Some(user_node.id)).await?;
        let mut messages: Vec<crate::modules::ai::model::AiProxyMessage> = Vec::new();
        if !system_prompt.trim().is_empty() {
            messages.push(crate::modules::ai::model::AiProxyMessage {
                role: "system".into(),
                content: system_prompt,
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
        self.repo.update_tree_timestamp(ctx.tree_id).await;
        Ok(assistant)
    }

    /// AI 失败后的清理（回滚新插入的 user 节点）
    pub async fn abort_chat(&self, ctx: &PreparedChat) {
        if let Some(new_id) = ctx.inserted_user_id {
            self.repo.delete_node(new_id).await;
        }
    }

    /// 流式对话编排（下沉自 handler）：准备 → 调 AI 流式转发 → 完成落库 / 失败回滚。
    ///
    /// 协议常量与 handler 共享（见 handler 的 SSE_DONE / SSE_ERROR_PREFIX）。
    pub async fn stream_chat(
        &self,
        actor: &Actor,
        ai: &dyn AiChatPort,
        tree_id: i64,
        parent_id: Option<i64>,
        content: Option<String>,
        tx: tokio::sync::mpsc::Sender<String>,
    ) -> Result<(), ServiceError> {
        let ctx = self
            .prepare_chat(actor, tree_id, parent_id, content)
            .await?;

        let result = ai
            .chat_stream(actor.user_id, &ctx.messages, None, None, Some(tx.clone()))
            .await;
        match result {
            Ok((full, _model, reasoning, _)) => {
                match self.finish_chat(&ctx, &full, reasoning.as_deref()).await {
                    Ok(_) => {
                        let _ = tx.send(SSE_DONE.to_string()).await;
                        Ok(())
                    }
                    Err(e) => {
                        let _ = tx.send(format!("{SSE_ERROR_PREFIX}{e}")).await;
                        self.abort_chat(&ctx).await;
                        Err(e)
                    }
                }
            }
            Err(e) => {
                let _ = tx.send(format!("{SSE_ERROR_PREFIX}{e}")).await;
                self.abort_chat(&ctx).await;
                Err(e)
            }
        }
    }

    /// 编辑节点 → 创建修订版（同父新节点，revised_from = 原节点）
    pub async fn revise_node(
        &self,
        actor: &Actor,
        node_id: i64,
        req: ReviseRequest,
    ) -> Result<ReviseResponse, ServiceError> {
        // 子表随父：节点归属经所属对话树判（别人的节点一律按不存在回）
        let node = self.ensure_node_owned(actor, node_id).await?;

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

        self.repo.update_tree_timestamp(node.tree_id).await;
        Ok(ReviseResponse { node: revised })
    }

    // ── 预设提示词 CRUD ──

    pub async fn list_presets(&self, actor: &Actor) -> Result<Vec<PresetItem>, ServiceError> {
        self.repo.list_presets(actor).await
    }

    pub async fn create_preset(
        &self,
        actor: &Actor,
        name: &str,
        content: &str,
    ) -> Result<PresetItem, ServiceError> {
        if name.trim().is_empty() {
            return Err(ServiceError::InvalidInput("预设名称不能为空".into()));
        }
        self.repo.create_preset(actor, name, content).await
    }

    pub async fn update_preset(
        &self,
        actor: &Actor,
        id: i64,
        name: &str,
        content: &str,
    ) -> Result<(), ServiceError> {
        self.repo.update_preset(actor, id, name, content).await
    }

    pub async fn delete_preset(&self, actor: &Actor, id: i64) -> Result<(), ServiceError> {
        self.repo.delete_preset(actor, id).await
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
    use crate::modules::chat::query::ChatQueryService;
    use crate::shared::search::SearchPort;
    use sqlx::SqlitePool;

    async fn setup() -> ChatService {
        setup_full().await.0
    }

    /// 服务 + 查询（搜索）两侧共用同一个内存库（顺带把池子交出去，供"绕过服务层"的断言用）
    async fn setup_full() -> (ChatService, ChatQueryService, SqlitePool) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::db::migrate(&pool).await.unwrap();
        (
            ChatService::new(pool.clone()),
            ChatQueryService::new(pool.clone()),
            pool,
        )
    }

    #[tokio::test]
    async fn create_and_get_tree() {
        let svc = setup().await;
        let detail = svc
            .create_tree(
                &Actor::user(1),
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

        let got = svc.get_tree(&Actor::user(1), detail.tree.id).await.unwrap().unwrap();
        assert_eq!(got.tree.id, detail.tree.id);
        assert_eq!(got.nodes.len(), 0);

        // 其他用户不可见
        assert!(svc.get_tree(&Actor::user(2), detail.tree.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn create_mem_tree_gets_builtin_prompt_and_kind_filter() {
        let svc = setup().await;
        let chat = svc
            .create_tree(
                &Actor::user(1),
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
                &Actor::user(1),
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
                &Actor::user(1),
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
        let mems = svc.list_trees_by_kind(&Actor::user(1), "mem").await.unwrap();
        assert_eq!(mems.len(), 1);
        assert_eq!(mems[0].title, "记忆生成");
        let chats = svc.list_trees_by_kind(&Actor::user(1), "chat").await.unwrap();
        assert_eq!(chats.len(), 2);
    }

    #[tokio::test]
    async fn revise_creates_new_node_keeping_original() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                &Actor::user(1),
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
                &Actor::user(1),
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
        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
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
                &Actor::user(1),
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
                &Actor::user(2),
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
                &Actor::user(1),
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

        svc.delete_tree(&Actor::user(1), tid).await.unwrap();
        assert!(svc.get_tree(&Actor::user(1), tid).await.unwrap().is_none());
        // 节点表已清空（间接通过 get_tree 验证）
    }

    #[tokio::test]
    async fn chat_prepare_abort_rolls_back_inserted_user() {
        let svc = setup().await;
        // 无 LLM 配置（from_env 返回 None）
        let tree = svc
            .create_tree(
                &Actor::user(1),
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
            .prepare_chat(&Actor::user(1), tid, None, Some("hello".into()))
            .await
            .unwrap();
        assert_eq!(ctx.inserted_user_id, Some(ctx.ai_parent_id.unwrap()));
        svc.abort_chat(&ctx).await;
        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 0);

        // user 节点应被回滚
        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 0);
    }

    #[tokio::test]
    async fn finish_chat_persists_reasoning() {
        let svc = setup().await;
        let tree = svc
            .create_tree(
                &Actor::user(1),
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
        let ctx = svc.prepare_chat(&Actor::user(1), tid, Some(user.id), None).await.unwrap();
        svc.finish_chat(&ctx, "回答内容", Some("推理过程内容"))
            .await
            .unwrap();

        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
        let assistant = got.nodes.iter().find(|n| n.role == "assistant").unwrap();
        assert_eq!(assistant.content, "回答内容");
        assert_eq!(assistant.reasoning.as_deref(), Some("推理过程内容"));

        // 无推理时落库为 None
        let ctx2 = svc
            .prepare_chat(&Actor::user(1), tid, Some(assistant.id), Some("追问".into()))
            .await
            .unwrap();
        svc.finish_chat(&ctx2, "再回答", None).await.unwrap();
        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
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

    // ── prepare_chat 分支矩阵（测试覆盖扩充）──

    async fn mk_tree(svc: &ChatService, prompt: &str) -> i64 {
        svc.create_tree(
            &Actor::user(1),
            CreateTreeRequest {
                title: "t".into(),
                system_prompt: prompt.into(),
                kind: None,
            },
        )
        .await
        .unwrap()
        .tree
        .id
    }

    #[tokio::test]
    async fn prepare_chat_tree_not_found() {
        let svc = setup().await;
        let Err(err) = svc.prepare_chat(&Actor::user(1), 999_999, None, Some("x".into())).await else {
            panic!("应因树不存在而失败");
        };
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    #[tokio::test]
    async fn prepare_chat_parent_from_other_tree_rejected() {
        let svc = setup().await;
        let tid_a = mk_tree(&svc, "").await;
        let tid_b = mk_tree(&svc, "").await;
        let node_a = svc
            .insert_node(tid_a, None, "user", "A 树的节点", None, None)
            .await
            .unwrap();

        let Err(err) = svc
            .prepare_chat(&Actor::user(1), tid_b, Some(node_a.id), Some("x".into()))
            .await
        else {
            panic!("应因跨树父节点而失败");
        };
        match err {
            ServiceError::InvalidInput(msg) => assert!(msg.contains("不属于")),
            other => panic!("期望 InvalidInput，实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn prepare_chat_blank_content_rejected() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await;
        for content in [None, Some("".into()), Some("   \n".into())] {
            let Err(err) = svc.prepare_chat(&Actor::user(1), tid, None, content).await else {
                panic!("空内容应被拒绝");
            };
            assert!(matches!(err, ServiceError::InvalidInput(_)));
        }
    }

    #[tokio::test]
    async fn prepare_chat_continuing_user_node_inserts_nothing() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await;
        let user = svc
            .insert_node(tid, None, "user", "q", None, None)
            .await
            .unwrap();

        // 继续 user 节点：不插入新节点，inserted_user_id 为 None
        let ctx = svc.prepare_chat(&Actor::user(1), tid, Some(user.id), None).await.unwrap();
        assert_eq!(ctx.inserted_user_id, None);
        assert_eq!(ctx.ai_parent_id, Some(user.id));
        // 消息链只有该 user 节点自己
        assert_eq!(ctx.messages.len(), 1);
        assert_eq!(ctx.messages[0].role, "user");
        assert_eq!(ctx.messages[0].content, "q");

        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
        assert_eq!(got.nodes.len(), 1); // 没有新增
    }

    #[tokio::test]
    async fn prepare_chat_replying_to_assistant_inserts_new_user_node() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await;
        let user = svc
            .insert_node(tid, None, "user", "q", None, None)
            .await
            .unwrap();
        let ctx1 = svc.prepare_chat(&Actor::user(1), tid, Some(user.id), None).await.unwrap();
        let assistant = svc.finish_chat(&ctx1, "a", None).await.unwrap();

        // 回复 assistant：必须带内容，并新插一个 user 节点挂在其下
        let ctx2 = svc
            .prepare_chat(&Actor::user(1), tid, Some(assistant.id), Some("追问".into()))
            .await
            .unwrap();
        let new_id = ctx2.inserted_user_id.expect("应插入新 user 节点");
        assert_eq!(ctx2.ai_parent_id, Some(new_id));
        // 消息链：q → a → 追问
        let contents: Vec<&str> = ctx2.messages.iter().map(|m| m.content.as_str()).collect();
        assert_eq!(contents, vec!["q", "a", "追问"]);
        let roles: Vec<&str> = ctx2.messages.iter().map(|m| m.role.as_str()).collect();
        assert_eq!(roles, vec!["user", "assistant", "user"]);
    }

    #[tokio::test]
    async fn prepare_chat_message_chain_starts_with_system_prompt() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "系统提示词").await;
        let ctx = svc
            .prepare_chat(&Actor::user(1), tid, None, Some("q".into()))
            .await
            .unwrap();
        assert_eq!(ctx.messages.len(), 2);
        assert_eq!(ctx.messages[0].role, "system");
        assert_eq!(ctx.messages[0].content, "系统提示词");
        assert_eq!(ctx.messages[1].role, "user");
    }

    // ── generate_title（测试覆盖扩充）──

    use crate::shared::error_types::ServiceError as SE;

    /// 一次被捕获的 AI 调用：messages、temperature?、max_tokens?
    type CapturedCall = (Vec<String>, Option<f32>, Option<i32>);

    /// 可编程回包的 AI 端口假实现
    struct FakeAi {
        reply: &'static str,
        captured: std::sync::Mutex<Vec<CapturedCall>>,
    }
    impl FakeAi {
        fn new(reply: &'static str) -> Self {
            Self {
                reply,
                captured: std::sync::Mutex::new(Vec::new()),
            }
        }
        fn calls(&self) -> Vec<CapturedCall> {
            self.captured.lock().unwrap().clone()
        }
    }
    #[async_trait::async_trait]
    impl AiChatPort for FakeAi {
        async fn chat(
            &self,
            _user_id: i32,
            messages: &[AiProxyMessage],
            temperature: Option<f32>,
            max_tokens: Option<i32>,
        ) -> Result<(String, String), SE> {
            self.captured.lock().unwrap().push((
                messages
                    .iter()
                    .map(|m| format!("{}:{}", m.role, m.content))
                    .collect(),
                temperature,
                max_tokens,
            ));
            Ok((self.reply.to_string(), "fake-model".into()))
        }

        async fn chat_stream(
            &self,
            _user_id: i32,
            _messages: &[AiProxyMessage],
            _temperature: Option<f32>,
            _max_tokens: Option<i32>,
            _tx: Option<tokio::sync::mpsc::Sender<String>>,
        ) -> Result<(String, String, Option<String>, bool), SE> {
            Ok((self.reply.to_string(), "fake-model".into(), None, false))
        }
    }

    #[tokio::test]
    async fn generate_title_rejects_empty_or_missing_tree() {
        let svc = setup().await;
        let ai = FakeAi::new("标题");

        let Err(err) = svc.generate_title(&Actor::user(1), 777, &ai).await else {
            panic!("树不存在应 NotFound")
        };
        assert!(matches!(err, ServiceError::NotFound(_)));

        let tid = mk_tree(&svc, "").await;
        let Err(err) = svc.generate_title(&Actor::user(1), tid, &ai).await else {
            panic!("空树应 InvalidInput")
        };
        assert!(matches!(err, ServiceError::InvalidInput(_)));
        assert!(ai.calls().is_empty(), "拒绝路径不应调用 AI");
    }

    #[tokio::test]
    async fn generate_title_sanitizes_and_persists() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await;
        let user = svc
            .insert_node(tid, None, "user", "什么是一次函数？", None, None)
            .await
            .unwrap();
        let ctx = svc.prepare_chat(&Actor::user(1), tid, Some(user.id), None).await.unwrap();
        svc.finish_chat(&ctx, "一次函数是……", None).await.unwrap();

        let ai = FakeAi::new("「一次函数与导数」\n");
        let title = svc.generate_title(&Actor::user(1), tid, &ai).await.unwrap();
        assert_eq!(title, "一次函数与导数"); // 去引号与换行

        // 标题已落库
        let got = svc.get_tree(&Actor::user(1), tid).await.unwrap().unwrap();
        assert_eq!(got.tree.title, "一次函数与导数");

        // AI 收到：system 提示 + 转写文本（用户/助手 前缀）
        let (msgs, temp, max) = &ai.calls()[0];
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].starts_with("system:"));
        assert!(msgs[1].contains("用户：什么是一次函数？"));
        assert!(msgs[1].contains("助手：一次函数是……"));
        assert_eq!(*temp, Some(0.3));
        assert_eq!(*max, Some(64));
    }

    #[tokio::test]
    async fn generate_title_blank_reply_rejected() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await;
        svc.prepare_chat(&Actor::user(1), tid, None, Some("q".into()))
            .await
            .unwrap();
        // 树里已有节点（上面 prepare 插入了 user 节点）
        let ai = FakeAi::new("   ");
        let Err(err) = svc.generate_title(&Actor::user(1), tid, &ai).await else {
            panic!("空白标题应被拒绝")
        };
        assert!(matches!(err, ServiceError::InvalidInput(_)));
    }

    #[tokio::test]
    async fn generate_title_foreign_tree_not_found() {
        let svc = setup().await;
        let tid = mk_tree(&svc, "").await; // 属于用户 1
        svc.prepare_chat(&Actor::user(1), tid, None, Some("q".into()))
            .await
            .unwrap();
        let ai = FakeAi::new("x");
        let Err(err) = svc.generate_title(&Actor::user(2), tid, &ai).await else {
            panic!("他人树应 NotFound")
        };
        assert!(matches!(err, ServiceError::NotFound(_)));
    }

    // ── 三档归属矩阵（自己 / 他人 / admin）──
    //
    // 判据在 `shared/actor.rs`：admin 全管，普通用户只管自己创建的；越权一律按
    // "不存在"回（`None` / `NotFound` / 0 行），不泄露资源是否存在。
    // `chat_node` 没有 user_id，归属随所属对话树（子表随父，见 time_window 的模板）。

    const OWNER: i32 = 1;
    const OTHER: i32 = 2;
    const ADMIN: i32 = 9;

    /// 矩阵夹具：`OWNER` 一棵带节点的树（标题/内容各留一组关键词）+ `OTHER` 一棵对照树
    struct Matrix {
        svc: ChatService,
        query: ChatQueryService,
        pool: SqlitePool,
        owner_tree: i64,
        owner_node: NodeItem,
    }

    async fn matrix() -> Matrix {
        let (svc, query, pool) = setup_full().await;

        // OWNER 的树：标题与节点内容各留一组关键词，供搜索的标题/节点两条命中路径用
        let owner_tree = svc
            .create_tree(
                &Actor::user(OWNER),
                CreateTreeRequest {
                    title: "费曼学习法".into(),
                    system_prompt: String::new(),
                    kind: None,
                },
            )
            .await
            .unwrap()
            .tree
            .id;
        let owner_node = svc
            .insert_node(owner_tree, None, "user", "费曼技巧四步", None, None)
            .await
            .unwrap();
        // 对照：OTHER 自己的树
        svc.create_tree(
            &Actor::user(OTHER),
            CreateTreeRequest {
                title: "别人的树".into(),
                system_prompt: String::new(),
                kind: None,
            },
        )
        .await
        .unwrap();
        Matrix {
            svc,
            query,
            pool,
            owner_tree,
            owner_node,
        }
    }

    /// 列表与详情：自己看得到、他人看不到（`None`）、admin 全量
    #[tokio::test]
    async fn ownership_matrix_tree_list_and_detail() {
        let m = matrix().await;

        assert_eq!(m.svc.list_trees(&Actor::user(OWNER)).await.unwrap().len(), 1);
        assert!(
            m.svc.get_tree(&Actor::user(OWNER), m.owner_tree)
                .await
                .unwrap()
                .is_some()
        );

        // 他人：列表里只有自己的那棵（看不到 OWNER 的），详情按不存在回
        let other_list = m.svc.list_trees(&Actor::user(OTHER)).await.unwrap();
        assert_eq!(other_list.len(), 1, "列表只回自己创建的");
        assert!(
            other_list.iter().all(|t| t.id != m.owner_tree),
            "别人的树不该出现在列表里"
        );
        assert!(
            m.svc.get_tree(&Actor::user(OTHER), m.owner_tree)
                .await
                .unwrap()
                .is_none(),
            "越权读按不存在回"
        );

        // admin 全管：两棵树都在
        assert_eq!(m.svc.list_trees(&Actor::admin(ADMIN)).await.unwrap().len(), 2);
        assert!(m.svc.get_tree(&Actor::admin(ADMIN), m.owner_tree).await.unwrap().is_some());

        // kind 过滤走的是同一条归属条件
        assert_eq!(
            m.svc.list_trees_by_kind(&Actor::user(OWNER), "chat").await.unwrap().len(),
            1
        );
        assert_eq!(
            m.svc.list_trees_by_kind(&Actor::user(OTHER), "chat").await.unwrap().len(),
            1,
            "他人只看得到自己那棵"
        );
        assert_eq!(
            m.svc.list_trees_by_kind(&Actor::admin(ADMIN), "chat").await.unwrap().len(),
            2
        );
    }

    /// 改名 / 改系统提示：自己生效、他人 NotFound（且没改动）、admin 生效
    #[tokio::test]
    async fn ownership_matrix_tree_update() {
        let m = matrix().await;

        let err = m
            .svc
            .update_tree(
                &Actor::user(OTHER),
                m.owner_tree,
                UpdateTreeRequest {
                    title: Some("偷改".into()),
                    system_prompt: None,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        let after = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.tree.title, "费曼学习法", "越权改动不应落库");

        m.svc
            .update_tree(
                &Actor::user(OWNER),
                m.owner_tree,
                UpdateTreeRequest {
                    title: Some("我的新标题".into()),
                    system_prompt: Some("我的提示词".into()),
                },
            )
            .await
            .unwrap();
        let after = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.tree.title, "我的新标题");
        assert_eq!(after.tree.system_prompt, "我的提示词");

        m.svc
            .update_tree(
                &Actor::admin(ADMIN),
                m.owner_tree,
                UpdateTreeRequest {
                    title: Some("admin 改的".into()),
                    system_prompt: None,
                },
            )
            .await
            .unwrap();
        let after = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(after.tree.title, "admin 改的");
    }

    /// 节点写入（`prepare_chat`）：他人写不进去（NotFound，不落任何节点）、admin 写得进
    #[tokio::test]
    async fn ownership_matrix_node_write() {
        let m = matrix().await;

        // 他人往 OWNER 的树里插：树本身就不该可见 → NotFound
        let Err(err) = m
            .svc
            .prepare_chat(&Actor::user(OTHER), m.owner_tree, None, Some("插话".into()))
            .await
        else {
            panic!("他人的树不该写得进去");
        };
        assert!(matches!(err, ServiceError::NotFound(_)));

        // 拿别人的节点当父节点（挂在 OTHER 自己的树下）也不行：子表随父
        let other_tree = m.svc.list_trees(&Actor::user(OTHER)).await.unwrap()[0].id;
        let Err(err) = m
            .svc
            .prepare_chat(
                &Actor::user(OTHER),
                other_tree,
                Some(m.owner_node.id),
                Some("续写".into()),
            )
            .await
        else {
            panic!("他人的父节点不该写得进去");
        };
        assert!(
            matches!(err, ServiceError::NotFound(_)),
            "他人的父节点按不存在回（不是 InvalidInput：不泄露节点存在）"
        );

        // 两次越权都没有落节点
        let nodes = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap()
            .nodes;
        assert_eq!(nodes.len(), 1, "越权写入不应产生节点");

        // admin 全管：写得进 OWNER 的树
        let ctx = m
            .svc
            .prepare_chat(&Actor::admin(ADMIN), m.owner_tree, None, Some("管理员的提问".into()))
            .await
            .unwrap();
        assert!(ctx.inserted_user_id.is_some());
        let nodes = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap()
            .nodes;
        assert_eq!(nodes.len(), 2, "admin 写入落在 OWNER 的树里");
        m.svc.abort_chat(&ctx).await; // 复用既有的回滚路径，保持夹具干净
    }

    /// 节点改写/分支（`revise_node`）：自己与 admin 建分支，他人 NotFound 且不落节点
    #[tokio::test]
    async fn ownership_matrix_node_revise() {
        let m = matrix().await;

        let Err(err) = m
            .svc
            .revise_node(
                &Actor::user(OTHER),
                m.owner_node.id,
                ReviseRequest {
                    content: "偷改".into(),
                },
            )
            .await
        else {
            panic!("他人的节点不该改得动");
        };
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert_eq!(
            m.svc
                .get_tree(&Actor::user(OWNER), m.owner_tree)
                .await
                .unwrap()
                .unwrap()
                .nodes
                .len(),
            1,
            "越权改写不应产生分支"
        );

        // 自己：同父新节点，revised_from 指向原节点
        let mine = m
            .svc
            .revise_node(
                &Actor::user(OWNER),
                m.owner_node.id,
                ReviseRequest {
                    content: "我的修订".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(mine.node.revised_from, Some(m.owner_node.id));
        assert_eq!(mine.node.content, "我的修订");

        // admin：也能改（全管）
        let theirs = m
            .svc
            .revise_node(
                &Actor::admin(ADMIN),
                m.owner_node.id,
                ReviseRequest {
                    content: "admin 的修订".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(theirs.node.revised_from, Some(m.owner_node.id));

        let nodes = m
            .svc
            .get_tree(&Actor::user(OWNER), m.owner_tree)
            .await
            .unwrap()
            .unwrap()
            .nodes;
        assert_eq!(nodes.len(), 3, "原节点保留 + 两次修订（越权那次没落）");
    }

    /// 删除：他人删不掉（树还在）、admin 删得掉（节点一并清空）
    #[tokio::test]
    async fn ownership_matrix_tree_delete() {
        let m = matrix().await;

        let err = m
            .svc
            .delete_tree(&Actor::user(OTHER), m.owner_tree)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert!(
            m.svc.get_tree(&Actor::user(OWNER), m.owner_tree).await.unwrap().is_some(),
            "越权删除不应生效"
        );

        m.svc.delete_tree(&Actor::admin(ADMIN), m.owner_tree).await.unwrap();
        assert!(
            m.svc.get_tree(&Actor::admin(ADMIN), m.owner_tree).await.unwrap().is_none(),
            "删掉之后连 admin 也查不到"
        );
        let leftover: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM chat_node WHERE tree_id = ?1")
            .bind(m.owner_tree)
            .fetch_one(&m.pool)
            .await
            .unwrap();
        assert_eq!(leftover, 0, "节点随树一起删");
    }

    /// 树内搜索：只搜得到自己（或 admin 的全量），标题命中与节点命中两条路径都收口
    #[tokio::test]
    async fn ownership_matrix_search() {
        let m = matrix().await;

        // 节点命中
        let mine = m.query.search(&Actor::user(OWNER), "费曼技巧四步", 20).await.unwrap();
        assert_eq!(mine.hits.len(), 1);
        assert_eq!(mine.hits[0].node_id, Some(m.owner_node.id));

        // 标题命中（树级）
        let mine = m.query.search(&Actor::user(OWNER), "费曼学习法", 20).await.unwrap();
        assert_eq!(mine.hits.len(), 1);
        assert_eq!(mine.hits[0].tree_id, m.owner_tree);
        assert_eq!(mine.hits[0].node_id, None);

        // 他人：两条路径都搜不到
        assert!(
            m.query.search(&Actor::user(OTHER), "费曼技巧四步", 20).await.unwrap().hits.is_empty()
                && m.query.search(&Actor::user(OTHER), "费曼学习法", 20).await.unwrap().hits.is_empty(),
            "搜索不得穿透归属"
        );

        // admin 全量：OWNER 的命中看得到
        assert_eq!(
            m.query.search(&Actor::admin(ADMIN), "费曼技巧四步", 20).await.unwrap().hits.len(),
            1
        );

        // 全局搜索端口（`SearchPort` 仍只收 user_id）按普通用户口径搜自己的
        let hits = SearchPort::search(&m.query, OWNER, "费曼技巧四步", 20).await.unwrap();
        assert_eq!(hits.len(), 1);
        assert!(
            hits.iter().all(|h| h.id == m.owner_tree),
            "命中只应属于自己的树"
        );
        assert!(
            SearchPort::search(&m.query, OTHER, "费曼技巧四步", 20).await.unwrap().is_empty(),
            "他人搜不到"
        );
    }

    /// 预设提示词（`prompt_preset`，同样是 NOT NULL 的 user_id）：读/改/删三档
    #[tokio::test]
    async fn ownership_matrix_presets() {
        let m = matrix().await;
        let preset = m
            .svc
            .create_preset(&Actor::user(OWNER), "我的预设", "内容")
            .await
            .unwrap();

        assert_eq!(m.svc.list_presets(&Actor::user(OWNER)).await.unwrap().len(), 1);
        assert!(m.svc.list_presets(&Actor::user(OTHER)).await.unwrap().is_empty());
        assert_eq!(m.svc.list_presets(&Actor::admin(ADMIN)).await.unwrap().len(), 1);

        let err = m
            .svc
            .update_preset(&Actor::user(OTHER), preset.id, "偷改", "x")
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        let err = m
            .svc
            .delete_preset(&Actor::user(OTHER), preset.id)
            .await
            .unwrap_err();
        assert!(matches!(err, ServiceError::NotFound(_)));
        assert_eq!(
            m.svc.list_presets(&Actor::user(OWNER)).await.unwrap().len(),
            1,
            "越权改删都不应生效"
        );

        // admin 全管
        m.svc
            .update_preset(&Actor::admin(ADMIN), preset.id, "admin 改的", "x")
            .await
            .unwrap();
        m.svc.delete_preset(&Actor::admin(ADMIN), preset.id).await.unwrap();
        assert!(m.svc.list_presets(&Actor::admin(ADMIN)).await.unwrap().is_empty());
    }
}
