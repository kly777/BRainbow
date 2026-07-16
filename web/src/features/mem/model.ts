// ── 记忆复习模块的类型定义 ──
// 从 apis/memApi.ts 和组件中提取的共享类型

/** 知识块：Markdown 内容 */
export interface Chunk {
	id: number;
	content: string;
	created_at: string;
}

/** 记忆项（含 chunk 展开） */
export interface MemItem {
	id: number;
	cue: Chunk;
	target: Chunk;
	state: string;
	stability: number;
	difficulty: number;
	due_at: string;
	lapses: number;
	leeched: boolean;
	mnemonic?: string | null;
}

/** getDue 返回结构 */
export interface DueResponse {
	readonly items: readonly MemItem[];
	due_count: number;
	has_more: boolean;
	upcoming_count: number;
	all_far: boolean;
}

/** 各状态计数 */
export interface MemCounts {
	new: number;
	learning: number;
	due: number;
	buried: number;
	suspended: number;
}

/** 本次学习预估 */
export interface SessionEstimate {
	due_count: number;
	retention: number;
	total_estimate: number;
}

export interface MemQuery {
	q?: string;
	state?: string;
	sort?: string;
	order?: string;
	tag_ids?: string;
	exclude_tag_ids?: string;
	page?: number;
	page_size?: number;
}

export interface TagInfo {
	id: number;
	name: string;
	created_at: string;
}

export interface MemTagRow {
	mem_id: number;
	id: number;
	name: string;
	created_at: string;
}
