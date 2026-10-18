// ── 书签页的多选与批量操作（删除 / AI 加标签） ──
//
// 从 useBookmarkPage 里切出来的一块：选中集合、全选判定、以及两条批量操作。
// 依赖（当前页条目、静默重载）由入口传入，不 import 同级 hook 的内部状态。

import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createSignal } from "solid-js";
import type { Bookmark } from "../../api.ts";
import {
	batchDeleteBookmarksE,
	setBookmarkTagsE,
	suggestBookmarkTagsE,
} from "../../api.ts";

export function useBookmarkSelection(deps: {
	items: () => Bookmark[];
	/** 批量操作后静默同步（不闪骨架） */
	reloadSilent: () => void;
}) {
	const [selectedIds, setSelectedIds] = createSignal<Set<number>>(new Set());
	const [batchTagging, setBatchTagging] = createSignal(false);

	function toggleSelect(id: number) {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function selectAll() {
		setSelectedIds(new Set(deps.items().map((b) => b.id)));
	}

	function clearSelection() {
		setSelectedIds(new Set<number>());
	}

	function isAllSelected() {
		const bks = deps.items();
		return bks.length > 0 && bks.every((b) => selectedIds().has(b.id));
	}

	function toggleSelectAll() {
		if (isAllSelected()) clearSelection();
		else selectAll();
	}

	async function handleBatchDelete() {
		const ids = Array.from(selectedIds());
		if (ids.length === 0) return;

		const confirmed = await showConfirm({
			title: "批量删除书签",
			message: `确定要删除选中的 ${ids.length} 个书签吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;

		const result = await tryAsync(() => batchDeleteBookmarksE(ids));
		if (result.ok) {
			notifySuccess(`已删除 ${ids.length} 个书签`);
			clearSelection();
			deps.reloadSilent();
		} else {
			notifyError("批量删除失败", result.error);
		}
	}

	/** 批量请 AI 建议标签并合并进每个书签（逐条失败不阻断其余） */
	async function handleBatchAiTag() {
		const ids = Array.from(selectedIds());
		if (ids.length === 0) return;

		setBatchTagging(true);
		let successCount = 0;
		let failCount = 0;
		let totalTagsAdded = 0;

		// 构建 id→bookmark 映射（拿现有标签做去重）
		const bmMap = new Map(deps.items().map((b) => [b.id, b]));

		for (const id of ids) {
			const bm = bmMap.get(id);
			if (!bm) continue;

			try {
				const suggestResult = await suggestBookmarkTagsE(id);
				const existing = new Set(bm.tags);
				const newTags = suggestResult.tags.filter((t) => !existing.has(t));
				if (newTags.length === 0) continue;

				await setBookmarkTagsE(id, [...bm.tags, ...newTags]);
				successCount++;
				totalTagsAdded += newTags.length;
			} catch {
				failCount++;
			}
		}

		setBatchTagging(false);
		clearSelection();

		if (successCount > 0) {
			notifySuccess(
				`AI 标签完成：${successCount} 个书签添加了 ${totalTagsAdded} 个标签` +
					(failCount > 0 ? `，${failCount} 个失败` : ""),
			);
			deps.reloadSilent();
		} else if (failCount > 0) {
			notifyError(`AI 标签失败：${failCount} 个书签`);
		} else {
			notifySuccess("AI 建议的标签都已存在，无需添加");
		}
	}

	return {
		selectedIds,
		toggleSelect,
		toggleSelectAll,
		isAllSelected,
		clearSelection,
		handleBatchDelete,
		batchTagging,
		handleBatchAiTag,
	};
}

export type BookmarkSelection = ReturnType<typeof useBookmarkSelection>;
