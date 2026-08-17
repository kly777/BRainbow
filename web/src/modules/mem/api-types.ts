// ── 记忆模块 API 类型 ──

// ── 类型 ──

export interface Chunk {
	id: number;
	content: string;
	created_at: string;
}

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

export interface DueResponse {
	items: readonly MemItem[];
	due_count: number;
	has_more: boolean;
	upcoming_count: number;
	all_far: boolean;
}

export interface MemQuery {
	q?: string;
	state?: string;
	sort?: string;
	order?: string;
	/** 按 id 直达单条记忆（全局搜索跳转用） */
	id?: number;
	tag_ids?: string;
	exclude_tag_ids?: string;
	page?: number;
	page_size?: number;
}

export interface MemCounts {
	new: number;
	learning: number;
	due: number;
	buried: number;
	suspended: number;
}

export interface SessionEstimate {
	due_count: number;
	retention: number;
	total_estimate: number;
	/** 最近复习记录的平均单卡秒数；0 = 无历史 */
	avg_seconds: number;
}

// ── re-export 共享类型 ──
export type {
	BatchDataResponse,
	BatchResponse,
	PaginatedResponse,
} from "@lib/api";
