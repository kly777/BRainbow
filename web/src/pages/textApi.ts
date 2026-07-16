import { CACHE, cachedRequest, request, tapInvalidate } from "../apis/request.ts";

export interface TabItem {
	readonly name: string;
	readonly content: string;
}

export interface TextResponse {
	readonly tabs: readonly TabItem[];
}

export const loadTextE = (): Promise<TextResponse> =>
	cachedRequest<TextResponse>("/text", {});

export const saveTextE = (
	tabs: readonly { name: string; content: string }[],
): Promise<{ readonly ok: boolean }> =>
	request<{ readonly ok: boolean }>("/text", {
		method: "PUT",
		body: JSON.stringify({ tabs }),
	}).then((r) => tapInvalidate(CACHE.text, r));
