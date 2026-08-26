// ── 书签导入功能 ──
// 从 useBookmarkPage 拆分：HTML 书签文件导入。

import { importBookmarksE } from "@modules/bookmark";
import { notifyError, notifySuccess, tryAsync } from "@shared/utils";
import { createSignal } from "solid-js";

export interface UseBookmarkImportOpts {
	/** 导入成功后的回调（刷新列表） */
	onImported: () => void;
}

export function useBookmarkImport(opts: UseBookmarkImportOpts) {
	const [importing, setImporting] = createSignal(false);

	async function handleImportFile(file: File | undefined) {
		if (!file) return;
		setImporting(true);
		const result = await tryAsync(() => importBookmarksE(file));
		if (result.ok) {
			notifySuccess(
				"导入完成",
				`新建 ${result.value.created} 条，合并标签 ${result.value.merged} 条`,
			);
			opts.onImported();
		} else {
			notifyError("导入失败", result.error);
		}
		setImporting(false);
	}

	return {
		importing,
		handleImportFile,
	};
}
