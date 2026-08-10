use serde::{Deserialize, Serialize};

/// AI 设置（返回给前端；api_key 不回显，只给 has_key）
#[derive(Serialize)]
pub struct AiSettingsItem {
    pub endpoint: String,
    pub model: String,
    pub mnemonic_prompt: String,
    pub has_key: bool,
}

/// 更新 AI 设置；api_key 传空 = 保持不变
#[derive(Deserialize)]
pub struct UpdateAiSettingsRequest {
    #[serde(default)]
    pub endpoint: Option<String>,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub mnemonic_prompt: Option<String>,
}

/// 通用代理请求（messages 与 OpenAI 兼容）
#[derive(Deserialize, Serialize)]
pub struct AiProxyRequest {
    pub messages: Vec<AiProxyMessage>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<i32>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct AiProxyMessage {
    pub role: String,
    pub content: String,
}

/// 完整 AI 配置（服务内部使用，含 api_key）
#[derive(Clone)]
pub struct AiConfig {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub mnemonic_prompt: String,
}
