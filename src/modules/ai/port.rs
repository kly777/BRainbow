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
}
