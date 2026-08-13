import { request } from "@lib/api";

// ── 类型 ──

export interface ChatTree {
	id: number;
	title: string;
	system_prompt: string;
	kind: string;
	created_at: string;
	updated_at: string;
	node_count: number;
}

export interface ChatNode {
	id: number;
	tree_id: number;
	parent_id: number | null;
	role: "user" | "assistant";
	content: string;
	revised_from: number | null;
	created_at: string;
	/** 推理思考内容（流式期间由临时节点携带，后端不落库） */
	reasoning?: string;
}

export interface TreeDetail {
	tree: ChatTree;
	nodes: ChatNode[];
}

export interface ChatResult {
	user: ChatNode;
	assistant: ChatNode;
}

export interface SearchHit {
	tree_id: number;
	tree_title: string;
	node_id: number | null;
	role: string;
	snippet: string;
	created_at: string;
}

export interface SearchResponse {
	hits: SearchHit[];
}

export interface PromptPreset {
	id: number;
	name: string;
	content: string;
	created_at: string;
}

// ── API ──

export const listTreesE = (): Promise<ChatTree[]> => request("/chat/trees", {});

/** 按类型列出对话：kind = "chat" | "mem" */
export const listTreesByKindE = (kind: string): Promise<ChatTree[]> =>
	request(`/chat/trees?kind=${encodeURIComponent(kind)}`, {});

export const createTreeE = (
	title: string,
	system_prompt: string,
	kind?: string,
): Promise<TreeDetail> =>
	request("/chat/trees", {
		method: "POST",
		body: JSON.stringify({
			title,
			system_prompt,
			...(kind ? { kind } : {}),
		}),
	});

export const getTreeE = (id: number): Promise<TreeDetail> =>
	request(`/chat/trees/${id}`, {});

export const updateTreeE = (
	id: number,
	patch: { title?: string; system_prompt?: string },
): Promise<void> =>
	request(`/chat/trees/${id}`, {
		method: "PATCH",
		body: JSON.stringify(patch),
	});

export const deleteTreeE = (id: number): Promise<void> =>
	request(`/chat/trees/${id}`, { method: "DELETE" });

export const chatE = (
	treeId: number,
	parent_id: number | null,
	content: string | null,
): Promise<ChatResult> =>
	request(`/chat/trees/${treeId}/chat`, {
		method: "POST",
		body: JSON.stringify({ parent_id, content }),
	});

export const reviseNodeE = (
	nodeId: number,
	content: string,
): Promise<{ node: ChatNode }> =>
	request(`/chat/nodes/${nodeId}/revise`, {
		method: "POST",
		body: JSON.stringify({ content }),
	});

export const searchChatE = (q: string): Promise<SearchResponse> =>
	request(`/chat/search?q=${encodeURIComponent(q)}`, {});

export const listPresetsE = (): Promise<PromptPreset[]> =>
	request("/chat/prompts", {});

export const createPresetE = (
	name: string,
	content: string,
): Promise<PromptPreset> =>
	request("/chat/prompts", {
		method: "POST",
		body: JSON.stringify({ name, content }),
	});

export const updatePresetE = (
	id: number,
	name: string,
	content: string,
): Promise<void> =>
	request(`/chat/prompts/${id}`, {
		method: "PATCH",
		body: JSON.stringify({ name, content }),
	});

export const deletePresetE = (id: number): Promise<void> =>
	request(`/chat/prompts/${id}`, { method: "DELETE" });
