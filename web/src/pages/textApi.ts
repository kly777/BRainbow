import { put } from "@apis/request.ts";
import { CACHE, cachedRequest, tapInvalidate } from "@apis/cache.ts";

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
	put<{ readonly ok: boolean }>("/text", { tabs }).then((r) =>
		tapInvalidate(CACHE.text, r),
	);
