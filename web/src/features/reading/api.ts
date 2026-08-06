import { post, put, request } from "@apis/request.ts";

// ── 类型 ──

export interface Article {
	id: number;
	title: string;
	content: string;
	word_count: number;
	notes: string;
	created_at: string;
}

export interface ArticleSummary {
	id: number;
	title: string;
	word_count: number;
	known_ratio: number;
	unknown_word_count: number;
	created_at: string;
}

export interface ArticleWordStatus {
	word: string;
	status: "known" | "unknown" | "ignored";
}

export interface ArticleDetail {
	article: Article;
	words: ArticleWordStatus[];
}

export interface UnknownWord {
	word: string;
	unknown_count: number;
	known_count: number;
	first_seen_at: string;
}

// ── API ──

export const listArticles = (): Promise<{ articles: ArticleSummary[] }> =>
	request("/reading", {});

export const getArticle = (id: number): Promise<ArticleDetail> =>
	request(`/reading/${id}`, {});

export const getArticleWords = (id: number): Promise<{ words: string[] }> =>
	request(`/reading/${id}/words`, {});

export const uploadArticle = (
	title: string,
	content: string,
): Promise<{ article: Article }> => post("/reading", { title, content });

export const markWord = (
	word: string,
	status: "known" | "unknown" | "ignored",
): Promise<{ ok: boolean }> =>
	post(`/reading/word/${encodeURIComponent(word)}`, { status });

export const listUnknownWords = (): Promise<{ words: UnknownWord[] }> =>
	request("/reading/unknown", {});

export const recommendNext = (
	id: number,
): Promise<{ recommended: ArticleSummary | null }> =>
	request(`/reading/${id}/recommend`, {});

export const getArticleNotes = (id: number): Promise<{ notes: string }> =>
	request(`/reading/${id}/notes`, {});

export const updateArticleNotes = (
	id: number,
	notes: string,
): Promise<{ ok: boolean }> => put(`/reading/${id}/notes`, { notes });
