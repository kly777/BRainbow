// ── 复习页键盘快捷键：空格翻面，1-4 评分 ──

import { onCleanup, onMount } from "solid-js";

const RATING_KEYS: Record<string, number> = {
	"1": 1,
	"2": 2,
	"3": 3,
	"4": 4,
};

/**
 * 注册复习页键盘监听（自动处理挂载/卸载）。
 *
 * - 空格：未翻面时翻面
 * - 1~4：已翻面时评分
 * - 输入框聚焦时不响应
 */
export function useReviewKeyboard(deps: {
	showAnswer: () => boolean;
	onShowAnswer: () => void;
	onRate: (rating: number) => void;
}): void {
	const onKey = (e: KeyboardEvent) => {
		if (
			e.target instanceof HTMLTextAreaElement ||
			(e.target as HTMLElement)?.tagName === "INPUT"
		)
			return;
		if (!deps.showAnswer() && e.key === " ") {
			e.preventDefault();
			deps.onShowAnswer();
		} else if (deps.showAnswer()) {
			const r = RATING_KEYS[e.key];
			if (r) deps.onRate(r);
		}
	};

	onMount(() => globalThis.addEventListener("keydown", onKey));
	onCleanup(() => globalThis.removeEventListener("keydown", onKey));
}
