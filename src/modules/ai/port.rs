//! AI 对外端口：chat 模块通过该 trait 调用 AI，不依赖具体 `AiService`。

use async_trait::async_trait;

use super::model::AiProxyMessage;
use crate::shared::error_types::ServiceError;

#[async_trait]
pub trait AiChatPort: Send + Sync {
    async fn chat(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
    ) -> Result<(String, String), ServiceError>;

    /// 流式调用：增量 token 通过 tx 发送（reasoning 带前缀），返回完整内容。
    async fn chat_stream(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        tx: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> Result<(String, String, Option<String>, bool), ServiceError>;
}
