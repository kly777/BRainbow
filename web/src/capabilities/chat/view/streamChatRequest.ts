// ── chat SSE 流式请求：读取 data 行，回调每个增量（content / reasoning） ──
// 复用 lib/api/streaming.ts 的全局认证和错误处理。

import { streamRequest } from "@shared/api";
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
 *
 * 认证和错误处理由 lib/api/streaming.ts 统一管理（401 → 登录弹窗）。
 */
export async function streamChatRequest(
	id: number,
	parentId: number | null,
	content: string | null,
	_token: string,
	signal: AbortSignal,
	onPatch: (text: string, reasoning: string) => void,
): Promise<StreamResult> {
	try {
		let acc = "";
		let reasoning = "";
		let done = false;

		await streamRequest({
			endpoint: `/chat/trees/${id}/chat`,
			body: { parent_id: parentId, content },
			signal,
			onChunk: (data) => {
				if (data === DONE_MARK) {
					done = true;
					return;
				}
				if (data.startsWith(ERROR_PREFIX)) {
					acc = data.slice(10);
					throw new Error(acc || "AI 生成失败");
				}
				if (data.startsWith(REASONING_PREFIX)) {
					reasoning += data.slice(6);
				} else {
					acc += data;
				}
				onPatch(acc, reasoning);
			},
		});

		if (!done) throw new Error("流式连接中断，请重试");
		return { ok: true, error: "" };
	} catch (e) {
		return { ok: false, error: (e as Error)?.message ?? "AI 生成失败" };
	}
}
