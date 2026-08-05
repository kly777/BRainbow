// ── 通用 AI 客户端 ──
// 支持任意兼容 OpenAI Chat Completions API 的服务

import { getAiSettings } from "@lib/ai-settings.ts";
import { tryAsync, trySync, unwrapOr } from "@lib/result.ts";

export interface AiMessage {
	role: "system" | "user" | "assistant";
	content: string;
}

export interface AiRequest {
	messages: AiMessage[];
	/** 覆盖全局设置中的 model */
	model?: string;
	temperature?: number;
	maxTokens?: number;
}

export interface AiResponse {
	content: string;
	model: string;
}

/** 调用 AI 并返回回复内容。失败时抛出 Error */
export async function callAi(req: AiRequest): Promise<AiResponse> {
	const settings = getAiSettings();

	if (!settings.apiKey) {
		throw new Error("未配置 API Key，请在 AI 设置中配置");
	}
	if (!settings.endpoint) {
		throw new Error("未配置 API 地址");
	}

	const body: Record<string, unknown> = {
		model: req.model ?? settings.model,
		messages: req.messages,
		temperature: req.temperature ?? 0.7,
		max_tokens: req.maxTokens ?? 512,
	};

	const response = await fetch(settings.endpoint, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${settings.apiKey}`,
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const textResult = await tryAsync(() => response.text());
		const errText = unwrapOr(textResult, "未知错误");
		throw new Error(
			`AI 请求失败 (${response.status}): ${errText.slice(0, 200)}`,
		);
	}

	const data = await response.json();
	const content = data.choices?.[0]?.message?.content;
	if (typeof content !== "string") {
		throw new Error("AI 返回格式异常：未找到回复内容");
	}

	return { content: content.trim(), model: data.model ?? settings.model };
}

/** 快捷方法：使用默认系统提示词发送用户消息 */
export async function askAi(
	userMessage: string,
	systemPrompt?: string,
): Promise<string> {
	const messages: AiMessage[] = [];
	if (systemPrompt) {
		messages.push({ role: "system", content: systemPrompt });
	}
	messages.push({ role: "user", content: userMessage });
	const res = await callAi({ messages });
	return res.content;
}
