// ── chat SSE 流式请求：读取 data 行，回调每个增量（content / reasoning） ──

import type { StreamResult } from "./useChatSessionTypes.ts";

/**
 * 发起流式请求并逐 token 回调。
 * data 行协议：普通行 = content 增量；`__R__:` 前缀 = reasoning 增量；
 * `__DONE__` 结束；`__ERROR__:<msg>` 出错。
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
		const resp = await fetch(`/api/chat/trees/${id}/chat`, {
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
				const data = trimmed.slice(5).trim();
				if (data === "__DONE__") {
					done = true;
					break;
				}
				if (data.startsWith("__ERROR__:")) {
					errored = true;
					acc = data.slice(10);
					break;
				}
				if (data.startsWith("__R__:")) {
					reasoning += data.slice(6);
					onPatch(acc, reasoning);
					continue;
				}
				acc += data;
				onPatch(acc, reasoning);
			}
		}

		if (errored) throw new Error(acc || "AI 生成失败");
		return { ok: true, error: "" };
	} catch (e) {
		return { ok: false, error: (e as Error)?.message ?? "AI 生成失败" };
	}
}
