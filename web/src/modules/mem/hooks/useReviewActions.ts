// ── 复习操作：评分、埋葬、暂停、编辑、复制 ──
// 从 useMemReview 拆分：所有用户操作（不包含队列管理和计时逻辑）。

import type { MemItem } from "@modules/mem";
import { buryMemE, editMemE, reviewMemE, suspendMemE } from "@modules/mem";
import { copyTextWithToast, notifyError, tryAsync } from "@shared/utils";
import type { Accessor, Setter } from "solid-js";

const ALPHA = 0.15;

export interface UseReviewActionsOpts {
	item: Accessor<MemItem | undefined>;
	/** queue.advanceQueue / queue.revisitCurrent / queue.reviewedIds / queue.setDue / queue.current */
	queue: {
		advanceQueue: () => void;
		revisitCurrent: (rating: number) => void;
		reviewedIds: Set<number>;
		setDue: (updater: (prev: MemItem[]) => MemItem[]) => void;
		current: Accessor<number>;
		loadDue: () => void;
	};
	undoHook: {
		record: (item: MemItem) => void;
		show: () => void;
	};
	mnemonicHook: {
		trackRating: (item: MemItem, rating: number) => void;
	};
	cardStart: Accessor<number>;
	avgRating: Accessor<number>;
	setAvgRating: Setter<number>;
	setCardDurations: Setter<number[]>;
	editing: Accessor<boolean>;
	setEditing: Setter<boolean>;
	editCue: Accessor<string>;
	setEditCue: Setter<string>;
	editTarget: Accessor<string>;
	setEditTarget: Setter<string>;
}

export function useReviewActions(opts: UseReviewActionsOpts) {
	const rate = async (rating: number) => {
		const it = opts.item();
		if (!it) return;
		opts.undoHook.record(it);
		const elapsed = Math.min((Date.now() - opts.cardStart()) / 1000, 300);

		const result = await tryAsync(() => reviewMemE(it.id, rating, elapsed));
		if (!result.ok) {
			notifyError("评分失败", result.error);
			return;
		}

		opts.setAvgRating((prev) => prev * (1 - ALPHA) + rating * ALPHA);
		opts.setCardDurations((prev) => [...prev, elapsed].slice(-30));
		opts.mnemonicHook.trackRating(it, rating);
		opts.undoHook.show();

		if (rating === 1 || rating === 2) {
			opts.queue.revisitCurrent(rating);
		} else {
			opts.queue.reviewedIds.add(it.id);
			opts.queue.advanceQueue();
		}
	};

	const bury = async () => {
		const it = opts.item();
		if (!it) return;
		const result = await tryAsync(() => buryMemE(it.id));
		if (result.ok) {
			opts.queue.reviewedIds.add(it.id);
			opts.queue.advanceQueue();
		} else {
			notifyError("埋葬失败", result.error);
		}
	};

	const resumeSuspend = async () => {
		const it = opts.item();
		if (!it) return;
		const result = await tryAsync(() => suspendMemE(it.id));
		if (result.ok) {
			opts.queue.loadDue();
		} else {
			notifyError("暂停失败", result.error);
		}
	};

	const startEdit = () => {
		const it = opts.item();
		if (it) {
			opts.setEditCue(it.cue.content);
			opts.setEditTarget(it.target.content);
			opts.setEditing(true);
		}
	};

	const saveEdit = async () => {
		const it = opts.item();
		if (!it) return;
		const result = await tryAsync(() =>
			editMemE(it.id, opts.editCue(), opts.editTarget()),
		);
		if (!result.ok) {
			notifyError("保存编辑失败", result.error);
			opts.setEditing(false);
			return;
		}
		opts.queue.setDue((prev) => {
			const next = [...prev];
			const idx = opts.queue.current();
			if (idx >= 0 && idx < next.length) {
				next[idx] = {
					...next[idx],
					cue: { ...next[idx].cue, content: opts.editCue() },
					target: { ...next[idx].target, content: opts.editTarget() },
				};
			}
			return next;
		});
		opts.setEditing(false);
	};

	const handleCopyCard = () => {
		const it = opts.item();
		if (!it) return;
		void copyTextWithToast(
			`线索:\n${it.cue.content}\n---\n答案:\n${it.target.content}`,
		);
	};

	return {
		rate,
		bury,
		resumeSuspend,
		startEdit,
		saveEdit,
		handleCopyCard,
	};
}
