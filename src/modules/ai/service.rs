use sqlx::SqlitePool;
use tokio::time::{Duration, sleep};

use crate::shared::error_types::ServiceError;
use async_trait::async_trait;

use super::model::{AiConfig, AiProxyMessage, AiSettingsItem, UpdateAiSettingsRequest};
use super::port::AiChatPort;
use super::repository::AiRepo;

/// AI 服务：设置 CRUD + LLM 代理调用（所有 AI 功能统一走这里）
#[derive(Clone)]
pub struct AiService {
    repo: AiRepo,
    client: reqwest::Client,
}

impl AiService {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            repo: AiRepo::new(pool),
            client: reqwest::Client::new(),
        }
    }

    /// 读取用户的完整 AI 配置
    pub async fn get_config(&self, user_id: i32) -> Result<Option<AiConfig>, ServiceError> {
        self.repo
            .get_config(user_id)
            .await
            .map_err(ServiceError::Db)
    }

    /// 返回前端可读设置（api_key 掩码）
    pub async fn get_settings(&self, user_id: i32) -> Result<AiSettingsItem, ServiceError> {
        let cfg = self.get_config(user_id).await?;
        Ok(match cfg {
            Some(c) => AiSettingsItem {
                endpoint: c.endpoint,
                model: c.model,
                mnemonic_prompt: c.mnemonic_prompt,
                has_key: !c.api_key.is_empty(),
            },
            None => AiSettingsItem {
                endpoint: String::new(),
                model: String::new(),
                mnemonic_prompt: String::new(),
                has_key: false,
            },
        })
    }

    /// 更新设置：api_key 传空保持原值
    pub async fn update_settings(
        &self,
        user_id: i32,
        req: UpdateAiSettingsRequest,
    ) -> Result<AiSettingsItem, ServiceError> {
        let existing = self.get_config(user_id).await?;
        let (old_endpoint, old_key, old_model, old_prompt) = match existing {
            Some(c) => (c.endpoint, c.api_key, c.model, c.mnemonic_prompt),
            None => (String::new(), String::new(), String::new(), String::new()),
        };

        let endpoint = req
            .endpoint
            .map(|s| s.trim().to_string())
            .unwrap_or(old_endpoint);
        let api_key = req
            .api_key
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or(old_key);
        let model = req.model.map(|s| s.trim().to_string()).unwrap_or(old_model);
        let mnemonic_prompt = req
            .mnemonic_prompt
            .map(|s| s.trim().to_string())
            .unwrap_or(old_prompt);

        self.repo
            .upsert_settings(user_id, &endpoint, &api_key, &model, &mnemonic_prompt)
            .await
            .map_err(ServiceError::Db)?;

        Ok(AiSettingsItem {
            endpoint,
            model,
            mnemonic_prompt,
            has_key: !api_key.is_empty(),
        })
    }

    /// 统一 LLM 调用：读用户配置 → 请求 OpenAI 兼容接口 → 返回回复内容
    pub async fn chat(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
    ) -> Result<(String, String), ServiceError> {
        let (content, model, _, _) = self
            .chat_stream(user_id, messages, temperature, max_tokens, None)
            .await?;
        Ok((content, model))
    }

    /// 流式 LLM 调用：逐块把回复内容发送到 tx（若提供），返回完整内容。
    /// 每个块是增量 token（前端直接拼接）；结束后返回完整文本。
    pub async fn chat_stream(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        tx: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> Result<(String, String, Option<String>, bool), ServiceError> {
        let cfg = self.get_config(user_id).await?.ok_or_else(|| {
            ServiceError::InvalidInput("请先在 AI 设置中配置 API 地址与 Key".into())
        })?;
        if cfg.endpoint.is_empty() || cfg.api_key.is_empty() {
            return Err(ServiceError::InvalidInput(
                "请先在 AI 设置中配置 API 地址与 Key".into(),
            ));
        }

        let body = serde_json::json!({
            "model": cfg.model,
            "messages": messages,
            "temperature": temperature.unwrap_or(0.7),
            // 推理模型（如 deepseek-v4-flash）会把大量 token 花在 reasoning_content 上，
            // 默认 8192 会被推理吃光导致 content 为空，需留足余量（模型支持 1M 上下文）
            "max_tokens": max_tokens.unwrap_or(32768),
            "stream": tx.is_some(),
        });

        // 简易重试：最多 2 次，间隔 1s（流式重试会重复推送已发 token，仅非流式重试）
        let mut last_err = None;
        let attempts = if tx.is_some() { 1 } else { 2 };
        for _attempt in 0..attempts {
            match self
                .client
                .post(&cfg.endpoint)
                .header("Content-Type", "application/json")
                .header("Authorization", format!("Bearer {}", cfg.api_key))
                .json(&body)
                .send()
                .await
            {
                Ok(resp) => {
                    if !resp.status().is_success() {
                        let status = resp.status().as_u16();
                        let text = match resp.text().await {
                            Ok(text) => text,
                            Err(e) => {
                                last_err = Some(ServiceError::Internal(format!(
                                    "AI 请求失败 ({status})，且读取错误响应失败: {e}"
                                )));
                                if tx.is_none() {
                                    sleep(Duration::from_millis(1000)).await;
                                }
                                continue;
                            }
                        };
                        last_err = Some(ServiceError::Internal(format!(
                            "AI 请求失败 ({status}): {}",
                            text.chars().take(200).collect::<String>()
                        )));
                        if tx.is_none() {
                            sleep(Duration::from_millis(1000)).await;
                        }
                        continue;
                    }

                    if let Some(tx) = &tx {
                        // 流式：用 eventsource-stream 解析 SSE（正确处理字节边界/UTF-8/多行）
                        use eventsource_stream::{Event, Eventsource};
                        use futures_util::StreamExt;
                        let mut full = String::new();
                        let mut reasoning_full = String::new();
                        let mut stream = resp.bytes_stream().eventsource();
                        while let Some(evt) = stream.next().await {
                            let evt = match evt {
                                Ok(e) => e,
                                Err(e) => {
                                    return Err(ServiceError::Internal(format!(
                                        "AI 流读取失败: {e}"
                                    )));
                                }
                            };
                            let Event { data, .. } = evt;
                            if data == "[DONE]" {
                                continue;
                            }
                            let v: serde_json::Value = match serde_json::from_str(&data) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            if let Some(delta) = v
                                .get("choices")
                                .and_then(|c| c.get(0))
                                .and_then(|c| c.get("delta"))
                            {
                                // 推理内容（如 deepseek 的 reasoning_content）：单独前缀推送，前端可折叠展示
                                if let Some(r) =
                                    delta.get("reasoning_content").and_then(|c| c.as_str())
                                    && !r.is_empty()
                                {
                                    reasoning_full.push_str(r);
                                    if tx.send(format!("{SSE_REASONING_PREFIX}{r}")).await.is_err()
                                    {
                                        break;
                                    }
                                }
                                if let Some(delta) = delta.get("content").and_then(|c| c.as_str()) {
                                    full.push_str(delta);
                                    if tx.send(delta.to_string()).await.is_err() {
                                        // 接收端关闭（客户端断开），停止推送但保留已收内容
                                        break;
                                    }
                                }
                            }
                        }
                        let content = full.trim().to_string();
                        if content.is_empty() {
                            return Err(ServiceError::Internal("AI 流式响应缺少回复内容".into()));
                        }
                        let reasoning = reasoning_full.trim().to_string();
                        let reasoning = (!reasoning.is_empty()).then_some(reasoning);
                        return Ok((content, cfg.model.clone(), reasoning, true));
                    } else {
                        // 非流式
                        let data: serde_json::Value = resp
                            .json()
                            .await
                            .map_err(|e| ServiceError::Internal(format!("AI 响应解析失败: {e}")))?;
                        let content = data
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("message"))
                            .and_then(|m| m.get("content"))
                            .and_then(|c| c.as_str())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .ok_or_else(|| ServiceError::Internal("AI 响应缺少回复内容".into()))?;
                        let reasoning = data
                            .get("choices")
                            .and_then(|c| c.get(0))
                            .and_then(|c| c.get("message"))
                            .and_then(|m| m.get("reasoning_content"))
                            .and_then(|c| c.as_str())
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty());
                        return Ok((content, cfg.model.clone(), reasoning, false));
                    }
                }
                Err(e) => {
                    last_err = Some(ServiceError::Internal(format!("AI 请求失败: {e}")));
                    if tx.is_none() {
                        sleep(Duration::from_millis(1000)).await;
                    }
                }
            }
        }
        Err(last_err.unwrap_or_else(|| ServiceError::Internal("AI 请求失败".into())))
    }
}

#[async_trait]
impl AiChatPort for AiService {
    async fn chat(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
    ) -> Result<(String, String), ServiceError> {
        self.chat(user_id, messages, temperature, max_tokens).await
    }

    async fn chat_stream(
        &self,
        user_id: i32,
        messages: &[AiProxyMessage],
        temperature: Option<f32>,
        max_tokens: Option<i32>,
        tx: Option<tokio::sync::mpsc::Sender<String>>,
    ) -> Result<(String, String, Option<String>, bool), ServiceError> {
        self.chat_stream(user_id, messages, temperature, max_tokens, tx)
            .await
    }
}

/// reasoning 流式前缀（前端 streamChatRequest.ts 的 REASONING_PREFIX 保持一致）
pub const SSE_REASONING_PREFIX: &str = "__R__:";

/// 从 SSE 字节流中解析出 content 增量（不直接使用，见 chat_stream 中 eventsource-stream；
/// 此处保留为纯函数，测试直接覆盖库的用法）。
#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]
    use eventsource_stream::Eventsource;
    use futures_util::StreamExt;

    fn sse_event(json: &str) -> Vec<u8> {
        format!("data: {json}\n\n").into_bytes()
    }

    async fn collect_events(stream: Vec<u8>) -> Vec<String> {
        // 按 1 字节切块喂给库（模拟 TCP 分块：命中 UTF-8 中间与行边界）
        let mut chunks: Vec<Result<Vec<u8>, ()>> =
            stream.into_iter().map(|b| Ok(vec![b])).collect();
        chunks.push(Ok(Vec::new())); // 结束信号
        let mut out = Vec::new();
        let mut es = futures_util::stream::iter(chunks).eventsource();
        while let Some(evt) = es.next().await {
            if let Ok(e) = evt {
                out.push(e.data);
            }
        }
        out
    }

    /// 多字节中文被 1 字节切块时不丢字符
    #[tokio::test]
    async fn sse_chunks_split_mid_utf8_keep_content() {
        let payload = serde_json::json!({
            "choices": [{
                "delta": { "content": "分布" }
            }]
        });
        let events = collect_events(sse_event(&payload.to_string())).await;
        assert_eq!(events.len(), 1);
        assert!(events[0].contains("分布"));
    }

    /// 多个 delta 事件逐个产出
    #[tokio::test]
    async fn sse_multiple_events() {
        let mk =
            |s: &str| serde_json::json!({ "choices": [{ "delta": { "content": s } }] }).to_string();
        let stream: Vec<u8> = [sse_event(&mk("A")), sse_event(&mk("B"))].concat();
        let events = collect_events(stream).await;
        assert_eq!(events.len(), 2);
        assert!(events[0].contains("A"));
        assert!(events[1].contains("B"));
    }

    /// [DONE] 结束标记也作为事件产出（上层自行跳过）
    #[tokio::test]
    async fn sse_done_marker() {
        let stream: Vec<u8> = b"data: [DONE]\n\n".to_vec();
        let events = collect_events(stream).await;
        assert_eq!(events, vec!["[DONE]"]);
    }
}
