// ── chat SSE 流式请求：读取 data 行，回调每个增量（content / reasoning） ──

import { API_BASE_URL } from "@lib/api";
import type { StreamResult } from "./useChatSessionTypes.ts";

// ── SSE data 行协议（与后端 src/modules/ai/service.rs、src/modules/chat/handler.rs 保持一致） ──
/** 普通行 = content 增量；`__R__:` 前缀 = reasoning 增量 */
const REASONING_PREFIX = "__R__:";
/** 流结束标记 */
const DONE_MARK = "__DONE__";
/** 错误前缀（后接错误文案） */
const ERROR_PREFIX = "__ERROR__:";

/**
 * 发起流式请求并逐 token 回调。
 * data 行协议见文件头常量（与后端 ai/service.rs、chat/handler.rs 保持一致）
 */
export async function streamChatRequest(
	id: number,
	parentId: number | null,
	content: string | null,
	token: string,
	signal: AbortSignal,
	onPatch: (text: string, reasoning: string) => void,
): Promise<StreamResult> {
	try {
		const resp = await fetch(`${API_BASE_URL}/chat/trees/${id}/chat`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ parent_id: parentId, content }),
			signal,
		});
		if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);
		if (!resp.body) throw new Error("浏览器不支持流式响应");

		let acc = "";
		let reasoning = "";
		const reader = resp.body.getReader();
		const decoder = new TextDecoder();

		let buffer = "";
		let done = false;
		let errored = false;
		while (!done) {
			const { value, done: streamDone } = await reader.read();
			if (streamDone) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith("data:")) continue;
				const raw = trimmed.slice(5);
				// 只按 SSE 规范去掉冒号后的一个空格，保留 token 内容自身的首尾空白
				const data = raw.startsWith(" ") ? raw.slice(1) : raw;
				if (data === DONE_MARK) {
					done = true;
					break;
				}
				if (data.startsWith(ERROR_PREFIX)) {
					errored = true;
					acc = data.slice(10);
					break;
				}
				if (data.startsWith(REASONING_PREFIX)) {
					reasoning += data.slice(6);
					onPatch(acc, reasoning);
					continue;
				}
				acc += data;
				onPatch(acc, reasoning);
			}
		}

		if (errored) throw new Error(acc || "AI 生成失败");
		if (!done) throw new Error("流式连接中断，请重试");
		return { ok: true, error: "" };
	} catch (e) {
		return { ok: false, error: (e as Error)?.message ?? "AI 生成失败" };
	}
}
