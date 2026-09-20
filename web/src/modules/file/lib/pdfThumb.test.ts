// ── PDF 首页缩略图（判定与降级路径；真正的渲染在浏览器里） ──
//
// jsdom 没有 canvas 的 2d 上下文，也没有 IntersectionObserver，所以这里锁的是
// 三件与渲染无关、但错了会出事的判断：**该不该渲染**（私密/缺失/超大）、
// **拿不到时怎么退**（不抛错、结果缓存）、**没有 IO 时怎么退化**（立刻渲染，
// 别把卡片卡在徽章上）。真正画出来的样子只能在浏览器里看。

import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileItem } from "../api.ts";
import {
	clearPdfThumbCache,
	loadPdfThumb,
	observeOnce,
	PDF_MAX_BYTES,
	PDF_THUMB_WIDTH,
	unobserve,
	wantsPdfThumb,
} from "./pdfThumb.ts";

const item = (over: Partial<FileItem> = {}): FileItem => ({
	id: 1,
	stored_id: "abcdefgh1234",
	url: "/api/file/abcdefgh1234/data/book.pdf",
	original_name: "book.pdf",
	mime_type: "application/pdf",
	file_category: "document",
	size_bytes: 12 * 1024 * 1024,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-21T00:00:00+00:00",
	updated_at: "2026-09-21T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
	...over,
});

afterEach(() => {
	clearPdfThumbCache();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("wantsPdfThumb", () => {
	it("公开的、体积合理的 PDF 才渲染", () => {
		expect(wantsPdfThumb(item())).toBe(true);
		expect(wantsPdfThumb(item({ size_bytes: PDF_MAX_BYTES }))).toBe(true);
	});

	it("私密 PDF 不渲染（列表的请求不带凭据，必然 401）", () => {
		expect(wantsPdfThumb(item({ is_private: true }))).toBe(false);
	});

	it("缺失文件不渲染", () => {
		expect(wantsPdfThumb(item({ missing: true }))).toBe(false);
	});

	it("超大 PDF 不渲染（避免为了缩略图拖一个大文件）", () => {
		expect(wantsPdfThumb(item({ size_bytes: PDF_MAX_BYTES + 1 }))).toBe(false);
	});

	it("别的类型不管（图片/视频有自己的链路）", () => {
		expect(wantsPdfThumb(item({ mime_type: "text/plain" }))).toBe(false);
		expect(wantsPdfThumb(item({ mime_type: "image/png" }))).toBe(false);
	});
});

describe("observeOnce", () => {
	it("没有 IntersectionObserver 时立刻回调（老环境与 jsdom 的退化路径）", () => {
		expect(typeof IntersectionObserver).toBe("undefined"); // jsdom 的事实，钉住前提
		let called = 0;
		observeOnce(document.createElement("div"), () => {
			called += 1;
		});
		expect(called).toBe(1);
	});

	it("有观察器时：进入视口才回调，且只回调一次", () => {
		const observed: Element[] = [];
		let trigger: ((entries: unknown[]) => void) | undefined;
		class FakeIO {
			constructor(cb: (entries: unknown[]) => void) {
				trigger = cb;
			}
			observe(el: Element) {
				observed.push(el);
			}
			unobserve() {}
			disconnect() {}
		}
		vi.stubGlobal("IntersectionObserver", FakeIO);

		let called = 0;
		const el = document.createElement("div");
		observeOnce(el, () => {
			called += 1;
		});

		expect(observed).toContain(el);
		expect(called).toBe(0);

		// 移出视口（未相交）不该触发
		trigger?.([{ target: el, isIntersecting: false }]);
		expect(called).toBe(0);

		trigger?.([{ target: el, isIntersecting: true }]);
		expect(called).toBe(1);

		// 再相交一次也不该重复渲染
		trigger?.([{ target: el, isIntersecting: true }]);
		expect(called).toBe(1);

		unobserve(el);
	});
});

describe("loadPdfThumb 的降级", () => {
	it("pdf.js 起不来（比如 jsdom 里没有 canvas）时不抛错，回调 undefined", async () => {
		const got = await new Promise<unknown>((resolve) =>
			loadPdfThumb(item(), (url) => resolve(url)),
		);
		// 动态 import 成功但渲染环境不成立（无 2d 上下文）→ undefined
		expect(got).toBeUndefined();
	});

	it("失败结果被缓存：重挂载不会再把整条渲染重跑一遍", async () => {
		const first = await new Promise<unknown>((resolve) =>
			loadPdfThumb(item(), (url) => resolve(url)),
		);
		expect(first).toBeUndefined();

		// 第二次应当是缓存命中 → 立刻回调（不 await 也不会挂）
		let second: unknown = "unset";
		loadPdfThumb(item(), (url) => {
			second = url;
		});
		expect(second).toBeUndefined();
	});

	it("不该渲染的文件一次都不试（回调根本不会被调用）", () => {
		let called = false;
		loadPdfThumb(item({ is_private: true }), () => {
			called = true;
		});
		expect(called).toBe(false);
	});
});

// ── pdf.js 的用法（真解析一份 PDF，验缩放算式） ──
//
// 渲染需要 canvas（jsdom 没有），但**解析与 viewport 计算不需要** —— 而这两步
// 正是"我猜的 API 用法"最可能出错的地方：页面尺寸取到了多少、scale 该乘什么。
// 这里手工拼一份最小 PDF（自己算 xref 偏移），让 pdf.js 真去解析。

/** 拼一份一页的最小 PDF：MediaBox 612×792（美式信纸），页面上有半个文字对象 */
function minimalPdf(): Uint8Array {
	const content = "BT /F1 24 Tf 72 700 Td (Hello) Tj ET\n";
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
		`<< /Length ${content.length} >>\nstream\n${content}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];

	let body = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((obj, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
	});

	const xrefStart = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets) {
		body += `${String(offset).padStart(10, "0")} 00000 n \n`;
	}
	body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

	return new TextEncoder().encode(body);
}

describe("pdf.js 用法", () => {
	it("worker 的 ?url 动态 import 解析成一个资源地址（vite 会把它发成独立资源）", async () => {
		const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
		expect(typeof mod.default).toBe("string");
		expect(mod.default).toMatch(/pdf\.worker\.min/);
	});

	it("第 1 页能解析出来，且 320 宽的缩放算式给出 320×414 的视口", async () => {
		// jsdom 里必须用 legacy 构建：display 构建在模块初始化时就要 DOMMatrix
		// （浏览器有，Node 没有）—— 业务代码走正常构建，这里只验 API 用法
		const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
		const doc = await pdfjs.getDocument({ data: minimalPdf() }).promise;
		try {
			expect(doc.numPages).toBe(1);
			const page = await doc.getPage(1);

			const base = page.getViewport({ scale: 1 });
			expect(base.width).toBeCloseTo(612, 0);
			expect(base.height).toBeCloseTo(792, 0);

			// 这正是 renderFirstPage 里的算式
			const scaled = page.getViewport({ scale: PDF_THUMB_WIDTH / base.width });
			expect(Math.round(scaled.width)).toBe(PDF_THUMB_WIDTH);
			expect(Math.round(scaled.height)).toBe(414);
		} finally {
			await doc.destroy();
		}
	});
});
