// ── 记忆管理页的批量操作 ──

import type { ConfirmOptions } from "../../../components/ui/confirmStore.ts";
import { notifyError } from "../../../lib/notify.ts";
import { tryAsync } from "../../../lib/result.ts";
import { showConfirm } from "../../../lib/safe-action.ts";
import {
	batchAddTagToMemsE,
	batchBuryMemE,
	batchDeleteMemE,
	batchRemoveTagFromMemsE,
	batchResetMemE,
	type TagInfo,
} from "../api.ts";

export interface UseBatchOps {
	batchDelete: () => Promise<void>;
	batchReset: () => Promise<void>;
	batchBury: () => Promise<void>;
	batchAddTag: (tag: TagInfo) => Promise<void>;
	batchRemoveTag: (tag: TagInfo) => Promise<void>;
}

interface Deps {
	/** 当前选中的 id 列表 */
	selectedIds: () => number[];
	/** 清空选择 */
	clearSelection: () => void;
	/** 操作成功后重载列表 */
	reload: () => void;
	/** 关闭详情面板（批量删除后调用） */
	closeDetail: () => void;
	/** 关闭批量标签弹窗（标签操作成功后调用） */
	closeTagModal: () => void;
}

/**
 * 批量操作 hook。所有操作遵循同一流程：
 * 取选中 id → （可选）确认 → 调 API → 清空选择 → 重载。
 */
export function useBatchOps(deps: Deps): UseBatchOps {
	/** 确认式批量操作（删除/重置/埋葬） */
	const runConfirmed = async (
		confirm: ConfirmOptions,
		label: string,
		action: (ids: number[]) => Promise<unknown>,
		after?: () => void,
	) => {
		const ids = deps.selectedIds();
		if (ids.length === 0) return;
		const confirmed = await showConfirm(confirm);
		if (!confirmed) return;

		const result = await tryAsync(() => action(ids));
		if (!result.ok) {
			notifyError(`${label}失败`, result.error);
			return;
		}
		deps.clearSelection();
		after?.();
		deps.reload();
	};

	/** 标签批量操作（无确认，成功后关闭弹窗） */
	const runTagOp = async (
		tag: TagInfo,
		label: string,
		action: (ids: number[], tagId: number) => Promise<unknown>,
	) => {
		const ids = deps.selectedIds();
		if (ids.length === 0) return;

		const result = await tryAsync(() => action(ids, tag.id));
		if (!result.ok) {
			notifyError(`${label}失败`, result.error);
			return;
		}
		deps.closeTagModal();
		deps.reload();
	};

	const batchDelete = () => {
		const count = deps.selectedIds().length;
		return runConfirmed(
			{
				title: "批量删除",
				message: `确定删除 ${count} 条记忆？此操作不可撤销。`,
				variant: "danger",
				confirmLabel: "删除",
			},
			"批量删除",
			batchDeleteMemE,
			deps.closeDetail,
		);
	};

	const batchReset = () => {
		const count = deps.selectedIds().length;
		return runConfirmed(
			{
				title: "批量重置",
				message: `确定重置 ${count} 条记忆的复习进度？`,
				variant: "warning",
				confirmLabel: "重置",
			},
			"批量重置",
			batchResetMemE,
		);
	};

	const batchBury = () => {
		const count = deps.selectedIds().length;
		return runConfirmed(
			{
				title: "批量埋葬",
				message: `确定埋葬 ${count} 条记忆？它们将不再出现在复习队列中。`,
				variant: "warning",
				confirmLabel: "埋葬",
			},
			"批量埋葬",
			batchBuryMemE,
		);
	};

	const batchAddTag = (tag: TagInfo) =>
		runTagOp(tag, "批量添加标签", batchAddTagToMemsE);

	const batchRemoveTag = (tag: TagInfo) =>
		runTagOp(tag, "批量移除标签", batchRemoveTagFromMemsE);

	return { batchDelete, batchReset, batchBury, batchAddTag, batchRemoveTag };
}
