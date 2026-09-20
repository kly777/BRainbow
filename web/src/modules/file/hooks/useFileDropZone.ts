// ── 整页拖放/粘贴上传 ──
// 自 FileList.tsx 抽出：该页曾达 930 行，交互逻辑与视图混在一起。
// 三个入口（拖入、粘贴、文件选择）最终都汇聚到同一个上传队列。

import { isTypingTarget } from "@shared/utils";
import { createSignal, onCleanup, onMount } from "solid-js";

export interface FileDropZone {
	/** 是否有文件正悬停在页面上（渲染投放高亮用） */
	dragging: () => boolean;
	onDragEnter: (e: DragEvent) => void;
	onDragOver: (e: DragEvent) => void;
	onDragLeave: () => void;
	onDrop: (e: DragEvent) => void;
}

/**
 * 整页文件投放。`onFiles` 通常是上传队列的入口。
 *
 * dragenter/dragleave 会在子元素之间反复触发，故用深度计数而非布尔量，
 * 否则拖动经过子元素时高亮会闪。
 */
export function useFileDropZone(
	onFiles: (files: File[]) => void,
): FileDropZone {
	const [dragging, setDragging] = createSignal(false);
	let depth = 0;

	return {
		dragging,
		onDragEnter: (e) => {
			if (!e.dataTransfer?.types.includes("Files")) return;
			e.preventDefault();
			depth += 1;
			setDragging(true);
		},
		onDragOver: (e) => {
			if (!e.dataTransfer?.types.includes("Files")) return;
			e.preventDefault();
			e.dataTransfer.dropEffect = "copy";
		},
		onDragLeave: () => {
			depth = Math.max(0, depth - 1);
			if (depth === 0) setDragging(false);
		},
		onDrop: (e) => {
			e.preventDefault();
			depth = 0;
			setDragging(false);
			const files = Array.from(e.dataTransfer?.files ?? []);
			if (files.length > 0) onFiles(files);
		},
	};
}

/** 从剪贴板事件里取出文件（截图粘贴）。输入框内的粘贴交给输入框自己处理。 */
export function filesFromPaste(e: ClipboardEvent): File[] {
	if (isTypingTarget(e.target)) return [];
	return Array.from(e.clipboardData?.items ?? [])
		.filter((item) => item.kind === "file")
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

/**
 * 整页粘贴上传：监听 document 的 paste，命中文件就交给 onFiles（并阻止默认行为）。
 * 输入框内的粘贴由 filesFromPaste 放行给输入框自己处理。
 */
export function usePasteFiles(onFiles: (files: File[]) => void): void {
	const onPaste = (e: ClipboardEvent) => {
		const files = filesFromPaste(e);
		if (files.length === 0) return;
		e.preventDefault();
		onFiles(files);
	};
	onMount(() => document.addEventListener("paste", onPaste));
	onCleanup(() => document.removeEventListener("paste", onPaste));
}
