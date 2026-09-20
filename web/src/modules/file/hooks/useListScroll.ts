// ── 列表滚动位置：离开时记住、回到列表时恢复一次 ──
//
// 从 FileList 的页面体里抽出来的一段。两条行为各自都有坑，所以放在一起写清楚：
//   1. **恢复要等数据渲染完**：列表还没高度时恢复会被截断，所以恢复动作依赖
//      `items()` 非空，且只做一次；
//   2. **是一次性的**：读完就删 key —— 否则下一次主动进入列表页也会被"恢复"到
//      上次离开的地方，那更像随机跳转而不是恢复。
//
// 另配一个"高亮项滚动定位"（上传命中已有文件时定位到它）：与恢复共用同一套
// 容器语义，但目标是元素而不是 scrollTop。

import { createEffect, onCleanup } from "solid-js";

export interface ListScrollOptions {
	/** 列表数据（非空即认为"渲染得差不多了"） */
	items: () => readonly unknown[];
	/** sessionStorage 键 */
	key: string;
}

export interface ListScroll {
	/** 高亮项出现时滚动定位（`highlight` 返回 id 时生效） */
	trackHighlight: (highlight: () => string | null) => void;
}

const scrollContainer = (): HTMLElement =>
	(document.querySelector("[data-scroll-container]") as HTMLElement | null) ??
	document.documentElement;

export function useListScroll(options: ListScrollOptions): ListScroll {
	// 离开时记住当前位置
	onCleanup(() => {
		sessionStorage.setItem(options.key, String(scrollContainer().scrollTop));
	});

	// 回来时恢复一次（等列表有高度，否则恢复会被截断）
	let restored = false;
	createEffect(() => {
		if (restored || options.items().length === 0) return;
		const saved = Number(sessionStorage.getItem(options.key) ?? "0");
		sessionStorage.removeItem(options.key); // 一次性：只在紧接的返回时生效
		restored = true;
		if (saved > 0) {
			requestAnimationFrame(() => {
				scrollContainer().scrollTop = saved;
			});
		}
	});

	const trackHighlight = (highlight: () => string | null) => {
		createEffect(() => {
			const id = highlight();
			if (!id) return;
			void options.items(); // 依赖列表数据，等渲染完成再定位
			const el = document.querySelector(`[data-file-id="${id}"]`);
			el?.scrollIntoView({ behavior: "smooth", block: "center" });
		});
	};

	return { trackHighlight };
}
