// ── 通用 AI 客户端 ──
// 统一走后端代理（/api/ai/chat）：AI 配置存数据库、用户端可配置，api_key 不进浏览器。

import { aiChatE } from "@entities/ai-setting";

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
	// model 覆盖暂由后端忽略（当前用数据库配置的 model）
	const res = await aiChatE(req.messages, {
		temperature: req.temperature,
		maxTokens: req.maxTokens,
	});
	return { content: res.content, model: res.model };
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
