// ── useChatSession 的公开类型 ──

import type { ChatTree } from "../api.ts";

export interface ChatSessionOptions {
	/** 树列表加载器（默认列出全部 kind） */
	listTreesFn?: () => Promise<ChatTree[]>;
	/** 新建会话的标题与 kind */
	createTitle: string;
	createKind?: "chat" | "mem";
	/** 新建/删除失败提示的前缀文案 */
	createLabel: string;
}

/** streamChat 的返回：ok=false 时 error 为可展示文案 */
export interface StreamResult {
	ok: boolean;
	error: string;
}
