// ── PDF 首页缩略图（前端 pdf.js，全程懒加载） ──
//
// 为什么只能在前端做：PDF 首页必须靠真渲染器。两条"看起来免费"的路都堵死了 ——
// ffmpeg 实测解不了 PDF（静态构建里没有 PDF 解码器），而 poppler/mupdf/pdfium
// 都没有像 johnvansickle 那样的静态发行渠道（要 apt/root 或自己编，与"二进制随
// 产物走"的部署决定冲突）。代价因此落在体积上：pdf.js 核 + worker 约 476KB gz，
// 走动态 import，不进首屏同步链。
//
// 与另外两条缩略图链路的三处不同：
// 1. **只在卡片进入视口后才开始**（IntersectionObserver）：单次成本比文本片段高
//    两个数量级（下载 pdf.js + Range 取首页对象 + canvas 渲染），不能"看不见也先渲染"；
// 2. 产物是 canvas 出的 blob URL，所以模糊底衬那份**零成本**：同一张图渲染两份，
//    浏览器已经在内存里解过一次；
// 3. 需要 worker：`?url` 动态 import 让 vite 把它单独发成资源，Caddy 的 CSP 里
//    worker 走 `default-src 'self'`，不用改部署配置。
//
// 渲染路径**没法在 jsdom 里验证**（没有 2d 上下文）：单测只覆盖"该不该渲染"、
// "失败怎么退"和观察器的兜底，真正画出来的样子要靠浏览器里看一眼。

import type { FileItem } from "../api.ts";

/** 渲染宽度（前端自己出图，不走后端那套阶梯） */
export const PDF_THUMB_WIDTH = 320;
/** 超过这个体积不渲染：pdf.js 只取首页所需的对象，但超大文件仍可能拖很久 */
export const PDF_MAX_BYTES = 200 * 1024 * 1024;
/** 首页多是文字，这个尺寸下 0.8 够看 */
const JPEG_QUALITY = 0.8;
/** blob URL 的保留上限（每个 ~20KB）：翻页来回看得多了也不该无限攒 */
const MAX_CACHED = 60;

/** 只有公开、未缺失、体积合理的 PDF 才渲染（私密文件的请求不带凭据） */
export function wantsPdfThumb(item: FileItem): boolean {
	return (
		!item.missing &&
		!item.is_private &&
		item.mime_type === "application/pdf" &&
		item.size_bytes > 0 &&
		item.size_bytes <= PDF_MAX_BYTES
	);
}

/** 结果缓存（blob URL）；`null` = 渲染过但没有（别每次重挂载都再试一遍） */
const cache = new Map<string, string | null>();
const inFlight = new Map<string, Promise<string | undefined>>();

function cacheKey(item: FileItem): string {
	return `${item.stored_id}:${item.content_hash ?? item.size_bytes}`;
}

/** 缓存写入 + 上限淘汰（淘汰时 revoke，blob URL 不 revoke 会一直占着内存） */
function remember(key: string, url: string | null): void {
	cache.set(key, url);
	if (cache.size <= MAX_CACHED) return;
	for (const [oldKey, oldUrl] of cache) {
		if (cache.size <= MAX_CACHED) break;
		cache.delete(oldKey);
		if (oldUrl) URL.revokeObjectURL(oldUrl);
	}
}

/**
 * 渲染第 1 页 → JPEG blob URL。任何一步失败都返回 undefined
 * （调用方继续显示后缀徽章，与另外两条链路一致）。
 */
async function renderFirstPage(item: FileItem): Promise<string | undefined> {
	// 动态 import：pdf.js 与它的 worker 只在真出现 PDF 卡片时才下载
	const pdfjs = await import("pdfjs-dist");
	const workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url"))
		.default;
	pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

	// disableAutoFetch：只取渲染首页需要的对象，不预取整个文件
	const doc = await pdfjs.getDocument({
		url: item.url,
		disableAutoFetch: true,
	}).promise;
	try {
		const page = await doc.getPage(1);
		const base = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({
			scale: PDF_THUMB_WIDTH / base.width,
		});

		const canvas = document.createElement("canvas");
		canvas.width = Math.max(1, Math.round(viewport.width));
		canvas.height = Math.max(1, Math.round(viewport.height));
		// jsdom 里没有 2d 上下文（getContext 返回 null）—— 真浏览器里必有
		if (!canvas.getContext("2d")) return undefined;

		// v5 的 RenderParameters 要 canvas（canvasContext 只是兼容旧写法）
		await page.render({ canvas, viewport }).promise;

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
		);
		return blob ? URL.createObjectURL(blob) : undefined;
	} finally {
		// 渲染完就释放文档：否则 worker 里会留着整个 PDF 的解析状态
		await doc.destroy();
	}
}

/**
 * 取这个 PDF 的首页缩略图（blob URL），拿不到就 undefined。
 * 结果进模块缓存；失败也缓存（null），避免每次重渲染都再打一遍。
 */
export function loadPdfThumb(
	item: FileItem,
	onReady: (url: string | undefined) => void,
): () => void {
	if (!wantsPdfThumb(item)) return () => {};

	const key = cacheKey(item);
	if (cache.has(key)) {
		onReady(cache.get(key) ?? undefined);
		return () => {};
	}

	let cancelled = false;
	let pending = inFlight.get(key);
	if (!pending) {
		pending = renderFirstPage(item)
			.catch(() => undefined)
			.then((url) => {
				remember(key, url ?? null);
				inFlight.delete(key);
				return url;
			});
		inFlight.set(key, pending);
	}

	pending.then((url) => {
		if (!cancelled) onReady(url);
	});
	return () => {
		cancelled = true;
	};
}

// ── 可见性观察（共享一个 IntersectionObserver） ──

const callbacks = new Map<Element, () => void>();
let observer: IntersectionObserver | undefined;

/**
 * 元素进入视口时回调一次（之后就注销）。**没有 IntersectionObserver 时立刻回调**：
 * 老环境与 jsdom 里都退化成"直接渲染"，不会把卡片卡在徽章上。
 */
export function observeOnce(el: Element, onVisible: () => void): void {
	if (typeof IntersectionObserver === "undefined") {
		onVisible();
		return;
	}
	callbacks.set(el, onVisible);
	observer ??= new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const callback = callbacks.get(entry.target);
				if (!callback) continue;
				callbacks.delete(entry.target);
				observer?.unobserve(entry.target);
				callback();
			}
		},
		// 提前 300px 开始：滚到卡片时首页通常已经渲染好了
		{ rootMargin: "300px" },
	);
	observer.observe(el);
}

/** 注销观察（组件卸载时） */
export function unobserve(el: Element): void {
	callbacks.delete(el);
	observer?.unobserve(el);
}

/** 清缓存（测试用；生产路径靠上面的上限淘汰） */
export function clearPdfThumbCache(): void {
	for (const url of cache.values()) if (url) URL.revokeObjectURL(url);
	cache.clear();
	inFlight.clear();
}
