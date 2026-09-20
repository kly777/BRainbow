// ── "复制后闪一下"：静默复制反馈 ──
//
// 两处各写了一遍：db 的单元格详情（copiedKey + 1200ms）与 csv/sheet 的单元格表
// （copied + 800ms）。差别只有时长，而时长是调用方的局部知识，于是收成参数。
//
// 收进来的还有一条容易漏的细节：**同一时刻只让最后一个键处于"刚复制"状态**，
// 到期回调要确认自己仍是当前键（连着抄几个值时，前一个的定时器不该把后一个的
// 高亮提前清掉）。

import { createSignal, onCleanup } from "solid-js";

/** 默认闪烁时长：够看清、又不至于一直亮着 */
export const COPY_FLASH_MS = 1200;

export interface CopyFlash {
	/** 当前处于"刚复制"状态的键；没有则为 undefined */
	copiedKey: () => string | undefined;
	/** 标记某个键刚被复制（到期自动清除） */
	flash: (key: string) => void;
}

export function useCopyFlash(options?: { durationMs?: number }): CopyFlash {
	const [copiedKey, setCopiedKey] = createSignal<string | undefined>();
	let timer: ReturnType<typeof setTimeout> | undefined;

	onCleanup(() => {
		if (timer !== undefined) clearTimeout(timer);
	});

	const flash = (key: string) => {
		setCopiedKey(key);
		if (timer !== undefined) clearTimeout(timer);
		timer = setTimeout(() => {
			timer = undefined;
			// 只清除自己那一次：期间又复制了别的键就让它继续亮
			setCopiedKey((current) => (current === key ? undefined : current));
		}, options?.durationMs ?? COPY_FLASH_MS);
	};

	return { copiedKey, flash };
}
