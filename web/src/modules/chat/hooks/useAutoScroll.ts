// ── 消息列表自动滚动：跟随最新内容，用户主动上滚看历史时不打扰 ──

import { type Accessor, createEffect } from "solid-js";

const NEAR_BOTTOM_PX = 100;

export function useAutoScroll(container: Accessor<HTMLElement | undefined>) {
	/** 用户最近一次滚动后是否位于底部；初始视为在底部（首次加载跟随到底） */
	let wasNearBottom = true;
	let bound: HTMLElement | undefined;

	const isNearBottom = (): boolean => {
		const el = container();
		if (!el) return true;
		return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
	};

	const scrollToBottom = () => {
		const el = container();
		if (el) el.scrollTop = el.scrollHeight;
	};

	/**
	 * 依赖项变化（消息列表/流式内容更新）时跟随滚动。
	 * - 用户未滚动（或最后停留在底部）→ 自动滚到底
	 * - 用户主动上滚 → 停止跟随，不打扰（滚动回底部后恢复跟随）
	 */
	const follow = (dep: Accessor<unknown>) => {
		createEffect(() => {
			const el = container();
			if (el && bound !== el) {
				bound = el;
				el.addEventListener("scroll", () => {
					wasNearBottom = isNearBottom();
				});
			}
			void dep();
			if (wasNearBottom) {
				requestAnimationFrame(scrollToBottom);
			}
		});
	};

	return { isNearBottom, scrollToBottom, follow };
}
