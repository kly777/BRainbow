// ── 列表的内容缩略：把 lib/thumbPreview 的取数接到组件上 ──
//
// 取数逻辑（缓存 / 去重 / 限并发）都在 lib/thumbPreview.ts 里，这里只管
// "认文件 → 起一次加载 → 把结果放进信号 → 卸载时注销回调"。

import { createEffect, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import { loadThumbPreview, type ThumbPreview } from "../lib/thumbPreview.ts";

/** 这个文件的内容缩略（可能一开始拿不到，稍后由回调补上） */
export function useThumbPreview(item: () => FileItem) {
	const [preview, setPreview] = createSignal<ThumbPreview | undefined>(
		undefined,
	);

	createEffect(() => {
		const current = item();
		let alive = true;
		onCleanup(() => {
			alive = false;
		});
		// 换文件时先清空：否则上一份内容会挂在新卡片上闪一下
		setPreview(undefined);
		const cancel = loadThumbPreview(current, (loaded) => {
			if (alive) setPreview(loaded);
		});
		onCleanup(cancel);
	});

	return preview;
}
