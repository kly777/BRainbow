import { request } from "@lib/api";

// ── 全局搜索 API ──

/** 搜索命中项的导航目标类型 */
export type SearchTargetType =
	| "Task"
	| "Card"
	| "Onto"
	| "Bookmark"
	| "Reading"
	| "Memory"
	| "ChatTree"
	| "ChatNode"
	| "Conv"
	| "Text";

/** 搜索命中项的导航目标 */
export interface SearchTarget {
	type: SearchTargetType;
	params: Record<string, number>;
}

export interface SearchHit {
	kind: string;
	id: number;
	title: string;
	snippet: string;
	target: SearchTarget;
}

export interface SearchResponse {
	hits: SearchHit[];
}

/** 跨模块站内搜索（记忆/卡片/任务/书签/本体/文本/阅读/对话/AI 对话） */
export const searchE = (q: string, limit = 4): Promise<SearchResponse> =>
	request(`/search?q=${encodeURIComponent(q)}&limit=${limit}`, {});
