// ── 卡片模块类型定义 ──

export interface Card {
	id: number;
	content: string;
	user_id: number;
	created_at: string;
	updated_at: string;
}

export interface CreateCardRequest {
	content: string;
}

export interface UpdateCardRequest {
	content: string;
}
