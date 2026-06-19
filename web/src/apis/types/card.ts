export interface Card {
	id: number;
	content: string;
	created_at: string;
	updated_at: string;
}

export interface CreateCardRequest {
	content: string;
}

export interface UpdateCardRequest {
	content?: string;
}
