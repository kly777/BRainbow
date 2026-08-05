// ── 评分撤销：记录最近一次评分前的 FSRS 状态，支持回滚 ──

import { createSignal } from "solid-js";
import { post } from "@apis/request.ts";
import { notifyError } from "@lib/notify.ts";
import { tryAsync } from "@lib/result.ts";
import type { MemItem } from "@features/mem/model.ts";

export interface UseUndo {
	showUndo: () => boolean;
	/** 评分前调用，记录当前卡片状态以便撤销 */
	record: (item: MemItem) => void;
	/** 评分成功后调用，显示撤销按钮 */
	show: () => void;
	/** 撤销最近一次评分，成功后触发 onUndone（通常是重新加载队列） */
	undo: () => Promise<void>;
}

export function useUndo(onUndone: () => void): UseUndo {
	const [showUndo, setShowUndo] = createSignal(false);

	let lastAction: { id: number; undoData: Record<string, unknown> } | null =
		null;

	const record = (item: MemItem) => {
		lastAction = {
			id: item.id,
			undoData: {
				state: item.state,
				stability: item.stability,
				difficulty: item.difficulty,
				step_index: null,
				lapses: 0,
				leeched: false,
				due_at: item.due_at,
			},
		};
	};

	const show = () => setShowUndo(true);

	const undo = async () => {
		if (!lastAction) return;
		const action = lastAction;
		const result = await tryAsync(() =>
			post(`/mem/${action.id}/undo`, action.undoData),
		);
		if (!result.ok) {
			notifyError("撤销评分失败", result.error);
			return;
		}
		setShowUndo(false);
		onUndone();
	};

	return { showUndo, record, show, undo };
}
