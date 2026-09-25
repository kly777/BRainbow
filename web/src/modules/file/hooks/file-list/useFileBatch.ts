// ── 多选与批量操作（删除 / 加标签 / 复制链接） ──
//
// 从 useFileList 里切出来的第三块。三条批量操作都是同一个形状：先乐观改列表、
// 再逐条发请求、按结果汇总（文案在 `lib/op-notices.ts`）、有失败或被跳过就回拉真值。

import { HttpError } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	tryAsync,
} from "@shared/utils";
import { createSignal } from "solid-js";
import { deleteFile, type FileItem, updateFile } from "../../api.ts";
import { batchAddTagNotice, batchDeleteNotice } from "../../lib/op-notices.ts";

export function useFileBatch(deps: {
	items: () => FileItem[];
	patchList: (
		update: (items: FileItem[]) => FileItem[],
		totalDelta?: number,
	) => void;
	refetch: () => void;
	refetchStats: () => void;
}) {
	const [selectMode, setSelectModeSignal] = createSignal(false);
	const [selected, setSelected] = createSignal<ReadonlySet<string>>(
		new Set<string>(),
	);

	const setSelectMode = (value: boolean) => {
		setSelectModeSignal(value);
		if (!value) setSelected(new Set<string>());
	};
	const toggleSelect = (storedId: string) =>
		setSelected((prev) => {
			const next = new Set<string>(prev);
			if (next.has(storedId)) next.delete(storedId);
			else next.add(storedId);
			return next;
		});
	const selectAll = () =>
		setSelected(new Set<string>(deps.items().map((item) => item.stored_id)));
	const clearSelection = () => setSelected(new Set<string>());

	/** 选中的条目（保持列表顺序） */
	const targets = () =>
		deps.items().filter((item) => selected().has(item.stored_id));

	/** 批量删除：逐个执行（尊重引用保护，被引用的跳过并汇总） */
	const batchDelete = async () => {
		const picked = targets();
		if (picked.length === 0) return;
		const confirmed = await showConfirm({
			title: `删除 ${picked.length} 个文件`,
			message:
				"被内容引用的文件会自动跳过（需单独确认强制删除）。此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;

		// 乐观：先把选中的都从列表移除
		const ids = new Set(picked.map((item) => item.stored_id));
		deps.patchList(
			(items) => items.filter((item) => !ids.has(item.stored_id)),
			-picked.length,
		);

		let ok = 0;
		let skipped = 0;
		let failed = 0;
		for (const item of picked) {
			const result = await tryAsync(() => deleteFile(item.stored_id, false));
			if (result.ok) {
				ok += 1;
			} else if (
				result.error instanceof HttpError &&
				result.error.status === 409
			) {
				skipped += 1;
			} else {
				failed += 1;
			}
		}

		const notice = batchDeleteNotice({ ok, skipped, failed });
		if (notice.level === "error") notifyError(notice.title, notice.message);
		else notifySuccess(notice.title, notice.message);

		setSelectMode(false);
		// 被引用跳过或失败的条目其实没删掉，需要拉回真值；全部成功则保持乐观结果
		if (skipped > 0 || failed > 0) deps.refetch();
		deps.refetchStats();
	};

	/** 批量加标签：读现有标签后追加（update 是全量替换语义） */
	const batchAddTag = async (tag: string) => {
		const name = tag.trim();
		if (!name) return;
		const picked = targets();
		if (picked.length === 0) return;

		// 乐观：先给选中项加上标签
		const ids = new Set(picked.map((item) => item.stored_id));
		deps.patchList((items) =>
			items.map((item) =>
				ids.has(item.stored_id) && !item.tags.includes(name)
					? { ...item, tags: [...item.tags, name] }
					: item,
			),
		);

		let ok = 0;
		let failed = 0;
		for (const item of picked) {
			if (item.tags.includes(name)) {
				ok += 1; // 已有该标签视为成功
				continue;
			}
			const result = await tryAsync(() =>
				updateFile(item.stored_id, { tags: [...item.tags, name] }),
			);
			if (result.ok) ok += 1;
			else failed += 1;
		}

		const notice = batchAddTagNotice({ ok, failed, name });
		if (notice.level === "error") notifyError(notice.title, notice.message);
		else notifySuccess(notice.title, notice.message);

		setSelectMode(false);
		if (failed > 0) deps.refetch();
	};

	/** 批量复制链接（逐行一条，方便贴进 Markdown 或清单） */
	const batchCopyLinks = async () => {
		const picked = targets();
		if (picked.length === 0) return;
		const result = await tryAsync(() =>
			navigator.clipboard.writeText(picked.map((item) => item.url).join("\n")),
		);
		if (result.ok) notifySuccess("已复制链接", `${picked.length} 条`);
		else notifyError("复制失败", result.error);
	};

	return {
		selectMode,
		setSelectMode,
		selected,
		toggleSelect,
		selectAll,
		clearSelection,
		batchDelete,
		batchAddTag,
		batchCopyLinks,
	};
}

export type FileBatch = ReturnType<typeof useFileBatch>;
