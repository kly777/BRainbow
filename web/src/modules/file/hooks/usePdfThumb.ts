// ── PDF 首页缩略图：把 lib/pdfThumb 的渲染接到组件上 ──
//
// 与前两条缩略图链路的关键差别在**触发时机**：渲染一个 PDF 首页要下载 pdf.js
// （~476KB gz）再按 Range 取首页对象，成本比取 1KB 文本片段高两个数量级，
// 所以必须等卡片真的进入视口再开始（`observeOnce`），而不是挂载即渲染。
//
// 宿主元素由调用方通过 `attach` 交进来（FileThumb 的那层 .thumb-host）。

import { createEffect, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import {
	loadPdfThumb,
	observeOnce,
	unobserve,
	wantsPdfThumb,
} from "../lib/pdfThumb.ts";

/** 返回 [首页缩略图的 blob URL, 把宿主元素交进来] */
export function usePdfThumb(item: () => FileItem) {
	const [url, setUrl] = createSignal<string | undefined>(undefined);
	const [host, setHost] = createSignal<HTMLElement | undefined>(undefined);
	const [visible, setVisible] = createSignal(false);

	// 观察宿主元素：进入视口一次就注销（列表滚动反复经过不该反复触发）
	createEffect(() => {
		const el = host();
		if (!el) return;
		onCleanup(() => unobserve(el));
		if (!wantsPdfThumb(item())) return;
		observeOnce(el, () => setVisible(true));
	});

	createEffect(() => {
		const current = item();
		// 换文件时先清空，否则上一份首页会挂在新卡片上闪一下
		setUrl(undefined);
		if (!visible() || !wantsPdfThumb(current)) return;
		let alive = true;
		onCleanup(() => {
			alive = false;
		});
		const cancel = loadPdfThumb(current, (loaded) => {
			if (alive) setUrl(loaded);
		});
		onCleanup(cancel);
	});

	return { url, attach: setHost };
}
