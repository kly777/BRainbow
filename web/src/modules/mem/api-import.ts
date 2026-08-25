// ── CSV 导入导出 API ──

import { CACHE, post, requestFile, withInvalidate } from "@lib/api";
import { downloadBlob } from "@lib/utils";

// ── CSV 导入导出 ──

export async function downloadExportCsv(tagIds?: number[]): Promise<void> {
	let endpoint = "/mem/export/csv";
	if (tagIds && tagIds.length > 0) {
		endpoint += `?tag_ids=${tagIds.join(",")}`;
	}
	const response = await requestFile(endpoint);
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
	withInvalidate(
		CACHE.mem,
		post<ImportCsvResult>("/mem/import/csv", {
			csv: csvContent,
			default_tags: defaultTags ?? [],
		}),
	);

export const importPsvE = (
	psvContent: string,
	defaultTags?: string[],
): Promise<ImportCsvResult> =>
	withInvalidate(
		CACHE.mem,
		post<ImportCsvResult>("/mem/import/psv", {
			csv: psvContent,
			default_tags: defaultTags ?? [],
		}),
	);

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
	withInvalidate(
		CACHE.mem,
		post<ImportJsonResult>("/mem/import/json", {
			mems,
			default_tags: defaultTags ?? [],
		}),
	);
