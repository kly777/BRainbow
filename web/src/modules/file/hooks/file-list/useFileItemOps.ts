// ── 单项操作：删除（含"被引用 → 强制删除"二次确认）与改名 ──
//
// 从 useFileList 里切出来的第四块。两条都是"乐观改本地 → 发请求 → 失败回拉真值"，
// 与批量操作同形但作用对象是单个条目。

import { getErrorMessage, HttpError } from "@shared/api";
import { notifyError, showConfirm, tryAsync } from "@shared/utils";
import { createSignal } from "solid-js";
import { deleteFile, type FileItem, updateFile } from "../../api.ts";

export function useFileItemOps(deps: {
	items: () => FileItem[];
	page: () => number;
	setPage: (page: number) => void;
	patchList: (
		update: (items: FileItem[]) => FileItem[],
		totalDelta?: number,
	) => void;
	refetch: () => void;
	refetchStats: () => void;
}) {
	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");

	/**
	 * 删除一个文件。被内容引用时后端回 409，这里升格为"强制删除"再确认一次；
	 * 用户在强删确认里取消时，把已经乐观移除的那条放回来。
	 */
	const handleDelete = async (storedId: string) => {
		let force = false;
		let removedLocally = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除文件" : "删除文件",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: "确定要删除这个文件吗？此操作不可撤销。",
				variant: "danger",
			});
			if (!confirmed) {
				if (removedLocally) deps.refetch(); // 取消强删 → 把乐观移除的那条放回来
				return;
			}
			if (!removedLocally) {
				// 先本地移除：卡片立刻消失，不等网络往返
				deps.patchList(
					(items) => items.filter((item) => item.stored_id !== storedId),
					-1,
				);
				removedLocally = true;
			}
			const result = await tryAsync(() => deleteFile(storedId, force));
			if (result.ok) break;
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除文件失败", getErrorMessage(result.error));
			deps.refetch(); // 回滚
			return;
		}
		deps.refetchStats();
		// 当前页最后一条被删掉时回退一页，避免停在空白页
		if (deps.items().length === 0 && deps.page() > 1) {
			deps.setPage(deps.page() - 1);
		}
	};

	const startRename = (item: FileItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setErrorMessage("");
	};

	const handleRename = async () => {
		const id = editingId();
		const name = editName().trim();
		if (!id || !name) return;
		// 乐观：立刻显示新名字并退出编辑态，失败再回到编辑态让用户修改
		deps.patchList((items) =>
			items.map((item) =>
				item.stored_id === id ? { ...item, original_name: name } : item,
			),
		);
		setEditingId(null);
		const result = await tryAsync(() =>
			updateFile(id, { original_name: name }),
		);
		if (!result.ok) {
			deps.refetch();
			setEditingId(id);
			setEditName(name);
			setErrorMessage(getErrorMessage(result.error));
		}
	};

	const cancelEdit = () => setEditingId(null);

	return {
		editingId,
		editName,
		setEditName,
		errorMessage,
		handleDelete,
		startRename,
		handleRename,
		cancelEdit,
	};
}

export type FileItemOps = ReturnType<typeof useFileItemOps>;
