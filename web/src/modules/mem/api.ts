// ── 记忆模块 API 入口：子文件实现 + 统一 re-export ──

import { put, request } from "@lib/api";

// ── AI 助记 ──

// ── AI 助记 ──

export const getMnemonicE = (
	memId: number,
): Promise<{ content: string | null }> => request(`/mem/${memId}/mnemonic`, {});

export const setMnemonicE = (
	memId: number,
	content: string,
): Promise<{ ok: boolean }> =>
	put<{ ok: boolean }>(`/mem/${memId}/mnemonic`, { content });

export interface UpcomingCounts {
	within_8h: number;
	within_24h: number;
}

export const getUpcomingCountsE = (): Promise<UpcomingCounts> =>
	request("/mem/upcoming-counts", {});

// ── re-export（保持模块对外接口不变） ──

export * from "./api-import.ts";
export * from "./api-mem.ts";
export * from "./api-tags.ts";
export * from "./api-types.ts";
