import { request } from "./request.ts";

// ── 类型 ──

export interface ConvHit {
	conv_id: number;
	title: string;
	conv_type: string;
	snippet: string;
	match_field: string;
	created_at: string;
	score: number;
	article_title?: string;
}

export interface SearchResponse {
	hits: ConvHit[];
	total: number;
}

export interface QaPair {
	qa_id: number;
	question: string;
	answer: string;
}

export interface ArticleItem {
	article_type: string;
	title: string;
	content: string;
}

export interface ConvDetail {
	conv_id: number;
	title: string;
	conv_type: string;
	created_at: string;
	qa_pairs: QaPair[];
	articles: ArticleItem[];
}

export interface ConvQaData {
	conv_id: number;
	title: string;
	conv_type: string;
	created_at: string;
	qa_pairs: QaPair[];
}

export interface ConvConceptData {
	conv_id: number;
	article_type: string;
	title: string;
	content: string;
}

// ── API ──

export type ConvSearchType = "all" | "conv" | "article";

export const searchConvE = (
	q: string,
	tab: ConvSearchType = "all",
	limit = 50,
): Promise<SearchResponse> =>
	request(
		`/conv/search?q=${encodeURIComponent(q)}&limit=${limit}&search_type=${tab}`,
	);

export const getConvDetailE = (id: number): Promise<ConvDetail> =>
	request(`/conv/${id}`);

export const getConvQaE = (id: number): Promise<ConvQaData> =>
	request(`/conv/qa/${id}`);

export const getConvConceptE = (
	id: number,
	article: string,
): Promise<ConvConceptData> =>
	request(`/conv/concept/${id}?article=${encodeURIComponent(article)}`);
