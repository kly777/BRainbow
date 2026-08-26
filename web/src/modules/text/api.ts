import { cachedRequest, domains, put } from "@shared/api";

export interface TabItem {
	readonly id: number;
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
	domains.text.invalidate(put<{ readonly ok: boolean }>("/text", { tabs }));
