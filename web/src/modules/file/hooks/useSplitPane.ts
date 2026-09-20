// ── 详情页两栏的宽度：拖拽调整 + 记住宽度 ──
//
// 原先这段（指针捕获 + 三个监听器 + localStorage 双写 + 键盘微调）和页面本体的
// 取数/渲染混在 FileDetail.tsx 里，占了页面近三分之一。抽成 hook 后页面上只剩
// "把宽度写进 style、把分隔条接上处理器"两行。
//
// 纯函数（夹取、解析、拖拽位移）留在 lib/splitPane.ts，那边的测试继续覆盖它们。

import { createSignal, onCleanup } from "solid-js";
import {
	draggedSideWidth,
	parseSideWidth,
	sideWidthKey,
} from "../lib/splitPane.ts";

/** 键盘微调一次的像素数（与鼠标拖拽共用同一套夹取） */
export const KEYBOARD_STEP_PX = 16;

export function useSplitPane() {
	/**
	 * 存**像素**而不是比例 —— 侧栏里是键值对文本、字号固定，"多宽能读"是绝对量。
	 */
	const [sideWidth, setSideWidth] = createSignal(
		parseSideWidth(localStorage.getItem(sideWidthKey)),
	);
	const [dragging, setDragging] = createSignal(false);

	const persist = (value: number) => {
		try {
			localStorage.setItem(sideWidthKey, String(value));
		} catch {
			// 存不了就算了：本次调整仍然生效
		}
	};

	const onDragStart = (e: PointerEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sideWidth();
		const target = e.currentTarget as HTMLElement;
		// 捕获指针：拖到分隔条外面（甚至拖出窗口）也不断线
		target.setPointerCapture(e.pointerId);
		setDragging(true);

		const onMove = (move: PointerEvent) => {
			setSideWidth(draggedSideWidth(startWidth, startX, move.clientX));
		};
		const onUp = () => {
			setDragging(false);
			target.releasePointerCapture?.(e.pointerId);
			persist(sideWidth());
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			target.removeEventListener("pointercancel", onUp);
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
		target.addEventListener("pointercancel", onUp);
		onCleanup(onUp);
	};

	/** 键盘微调：与鼠标语义一致 —— 左方向键 = 把分隔条往左移（侧栏因此变宽） */
	const onKeyDown = (e: KeyboardEvent) => {
		const pointerDelta =
			e.key === "ArrowLeft"
				? -KEYBOARD_STEP_PX
				: e.key === "ArrowRight"
					? KEYBOARD_STEP_PX
					: 0;
		if (pointerDelta === 0) return;
		e.preventDefault();
		const next = draggedSideWidth(sideWidth(), 0, pointerDelta);
		setSideWidth(next);
		persist(next);
	};

	return { sideWidth, dragging, onDragStart, onKeyDown };
}
