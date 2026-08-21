import { request } from "@lib/api";

// ── AI 设置（数据库存储，后端代理） ──

export interface AiSettingsItem {
	endpoint: string;
	model: string;
	mnemonic_prompt: string;
	has_key: boolean;
}

export interface AiSettingsUpdate {
	endpoint?: string;
	api_key?: string;
	model?: string;
	mnemonic_prompt?: string;
}

export const getAiSettingsE = (): Promise<AiSettingsItem> =>
	request("/ai/settings", {});

export const updateAiSettingsE = (
	patch: AiSettingsUpdate,
): Promise<AiSettingsItem> =>
	request("/ai/settings", { method: "PUT", body: JSON.stringify(patch) });

// ── 通用 AI 代理调用 ──

export interface AiProxyMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export const aiChatE = (
	messages: AiProxyMessage[],
	opts?: { temperature?: number; maxTokens?: number },
): Promise<{ content: string; model: string }> =>
	request("/ai/chat", {
		method: "POST",
		body: JSON.stringify({
			messages,
			temperature: opts?.temperature,
			max_tokens: opts?.maxTokens,
		}),
		// 推理模型长回复可能远超 15s，不做默认超时
		timeout: false,
	});
