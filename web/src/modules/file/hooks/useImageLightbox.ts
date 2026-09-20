// ── 图片灯箱的索引：当前页的图片之间左右切换 ──
//
// 从 FileList 的页面体里抽出来的一段（原先页面直接拿着 lightboxId 信号、自己算
// index、自己在导航回调里按 index 反查 stored_id）。抽出来之后，"可放大的图片有哪些"
// 与"当前是哪一张"这两件事只在这一处定义，页面只接一个 index 与一个 onNavigate。
//
// 索引按 `-1 = 未打开` 表达：ImageLightbox 只在 index >= 0 时渲染，
// 这样页面不必再维护第二个"是否打开"的布尔量。

import { type Accessor, createMemo, createSignal } from "solid-js";
import type { FileItem } from "../api.ts";
import { canZoom } from "../lib/thumbnail.ts";

export interface ImageLightboxState {
	/** 可放大的图片（灯箱里翻页的范围） */
	items: Accessor<FileItem[]>;
	/** 当前图片在 items 里的下标；-1 表示灯箱未打开 */
	index: Accessor<number>;
	open: (item: FileItem) => void;
	close: () => void;
	/** 翻到第 index 张（越界忽略） */
	navigate: (index: number) => void;
}

export function useImageLightbox(
	list: () => readonly FileItem[],
): ImageLightboxState {
	const [currentId, setCurrentId] = createSignal<string | null>(null);

	// 可放大判定与卡片/列表行共用一处（lib/thumbnail.ts 的 canZoom）
	const items = createMemo(() => list().filter(canZoom));

	const index = () => {
		const id = currentId();
		if (!id) return -1;
		return items().findIndex((item) => item.stored_id === id);
	};

	return {
		items,
		index,
		open: (item) => setCurrentId(item.stored_id),
		close: () => setCurrentId(null),
		navigate: (next) => {
			const target = items()[next];
			if (target) setCurrentId(target.stored_id);
		},
	};
}
