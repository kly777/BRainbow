// ── CSV 导入导出 API ──

import { CACHE, getToken, post, tapInvalidate } from "@lib/api";
import { downloadBlob } from "@lib/utils";

// ── CSV 导入导出 ──

export async function downloadExportCsv(tagIds?: number[]): Promise<void> {
	const token = getToken();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;

	let url = "/api/mem/export/csv";
	if (tagIds && tagIds.length > 0) {
		url += `?tag_ids=${tagIds.join(",")}`;
	}

	const response = await fetch(url, { headers });
	if (!response.ok) {
		const err = await response.text();
		throw new Error(err || "导出失败");
	}
	const blob = await response.blob();
	downloadBlob(blob, `mems_${new Date().toISOString().slice(0, 10)}.csv`);
}

export interface ImportCsvResult {
	imported: number;
	errors: string[];
}

export const importCsvE = (
	csvContent: string,
	defaultTags?: string[],
): Promise<ImportCsvResult> =>
	post<ImportCsvResult>("/mem/import/csv", {
		csv: csvContent,
		default_tags: defaultTags ?? [],
	}).then((r) => tapInvalidate(CACHE.mem, r));

export const importPsvE = (
	psvContent: string,
	defaultTags?: string[],
): Promise<ImportCsvResult> =>
	post<ImportCsvResult>("/mem/import/psv", {
		csv: psvContent,
		default_tags: defaultTags ?? [],
	}).then((r) => tapInvalidate(CACHE.mem, r));

export interface ImportJsonItem {
	cue: string;
	target: string;
	tags?: string[];
}

export interface ImportJsonResult {
	imported: number;
	errors: string[];
}

export const importJsonE = (
	mems: ImportJsonItem[],
	defaultTags?: string[],
): Promise<ImportJsonResult> =>
	post<ImportJsonResult>("/mem/import/json", {
		mems,
		default_tags: defaultTags ?? [],
	}).then((r) => tapInvalidate(CACHE.mem, r));
