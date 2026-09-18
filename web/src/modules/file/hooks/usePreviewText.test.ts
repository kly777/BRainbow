// ── usePreviewText：分段取内容（首屏 / 载入更多 / 看结尾） ──
//
// 三条容易回归的地方，逐一钉住：
//   1. 「载入更多」用的是**续取的偏移**（不是又从 0 开始）
//   2. 「看结尾」走 `bytes=-N` 后缀请求，一次就到尾部（后端早已支持，见 §8.6）
//   3. 多字节字符被切在两段之间时不能丢 —— 跨段共用一个解码器才能补齐

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { item } from "../viewers/test-fixtures.ts";
import { usePreviewText } from "./usePreviewText.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await tick();
}

/**
 * 一个会按 Range 正确切字节的假服务端（同时记录收到的 Range 头）。
 * 支持 `bytes=a-b` 与后缀 `bytes=-n`，按规范回 206 + Content-Range。
 */
function stubServer(body: Uint8Array) {
	const ranges: string[] = [];
	const total = body.length;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			const range = new Headers(init?.headers).get("range") ?? "";
			ranges.push(range);
			const suffix = /bytes=-(\d+)/.exec(range);
			if (suffix) {
				const start = Math.max(0, total - Number(suffix[1]));
				return new Response(new Uint8Array(body.subarray(start)), {
					status: 206,
					headers: { "content-range": `bytes ${start}-${total - 1}/${total}` },
				});
			}
			const open = /bytes=(\d+)-(\d+)/.exec(range);
			if (open) {
				const start = Number(open[1]);
				const end = Math.min(Number(open[2]), total - 1);
				return new Response(new Uint8Array(body.subarray(start, end + 1)), {
					status: 206,
					headers: { "content-range": `bytes ${start}-${end}/${total}` },
				});
			}
			return new Response(new Uint8Array(body));
		}),
	);
	return ranges;
}

const bytes = (s: string) => new TextEncoder().encode(s);

/** 在响应式根里挂载 hook（effect 要等一次微任务才跑） */
function mount(segmentBytes: number) {
	let api!: ReturnType<typeof usePreviewText>;
	let dispose!: () => void;
	createRoot((d) => {
		dispose = d;
		api = usePreviewText(() => item({ mime_type: "text/plain" }), segmentBytes);
	});
	return { api, dispose };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("usePreviewText 分段", () => {
	it("首屏取一段；载入更多从已取长度往后续", async () => {
		const ranges = stubServer(bytes("abcdefghijkl"));
		const { api, dispose } = mount(4);

		await settle(() => api.content() !== undefined);
		expect(ranges[0]).toBe("bytes=0-3");
		expect(api.content()?.text).toBe("abcd");
		expect(api.content()?.truncated).toBe(true);
		expect(api.content()?.loadedBytes).toBe(4);

		api.loadMore();
		await settle(() => (api.content()?.text ?? "").length > 4);
		expect(ranges[1]).toBe("bytes=4-7");
		expect(api.content()?.text).toBe("abcdefgh");
		expect(api.content()?.loadedBytes).toBe(8);

		api.loadMore();
		await settle(() => api.content()?.truncated === false);
		expect(ranges[2]).toBe("bytes=8-11");
		expect(api.content()?.text).toBe("abcdefghijkl");
		dispose();
	});

	it("看结尾：一次后缀请求到尾部，不再有截断", async () => {
		const ranges = stubServer(bytes("abcdefghijkl"));
		const { api, dispose } = mount(4);

		await settle(() => api.content() !== undefined);
		api.loadTail();
		await settle(() => api.content()?.atTail === true);

		expect(ranges[1]).toBe("bytes=-4");
		expect(api.content()?.text).toBe("ijkl");
		expect(api.content()?.truncated).toBe(false);
		expect(api.content()?.loadedBytes).toBe(12);

		// 回到开头：又是一次头部请求，atTail 复位
		api.reload();
		await settle(() => api.content()?.atTail === false);
		expect(api.content()?.text).toBe("abcd");
		dispose();
	});

	it("多字节字符被切在两段之间时，由下一段补齐（跨段共用一个解码器）", async () => {
		// "中文中文" = 12 字节；段长 5 → 第一段正好切在第二个字的中间
		const ranges = stubServer(bytes("中文中文"));
		const { api, dispose } = mount(5);

		await settle(() => api.content() !== undefined);
		// 半个字不能显示成"中�"：不全的序列留在解码器缓冲里
		expect(api.content()?.text).toBe("中");

		api.loadMore();
		await settle(() => (api.content()?.text ?? "").length > 1);
		expect(api.content()?.text).toBe("中文中");

		api.loadMore();
		await settle(() => api.content()?.truncated === false);
		expect(api.content()?.text).toBe("中文中文");
		expect(ranges).toEqual(["bytes=0-4", "bytes=5-9", "bytes=10-14"]);
		dispose();
	});

	it("服务端忽略 Range（200 整包）时，续取退化成重新装载而不是重复拼接", async () => {
		const full = bytes("abcdefghijkl");
		const ranges = stubServer(full);
		const { api, dispose } = mount(4);

		await settle(() => api.content() !== undefined);
		// 让下一次请求回整包（老后端 / 中间缓存会这样）
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(new Uint8Array(full))),
		);
		api.loadMore();
		await settle(() => (api.content()?.text ?? "").length === 12);
		expect(api.content()?.text).toBe("abcdefghijkl");
		expect(api.content()?.truncated).toBe(false);
		expect(ranges.length).toBe(1); // 只发过首屏那一次
		dispose();
	});

	it("失败给可重试的错误，重试后恢复", async () => {
		stubServer(bytes("hello"));
		const { api, dispose } = mount(4);
		await settle(() => api.content() !== undefined);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("boom", { status: 503 })),
		);
		api.loadMore();
		await settle(() => api.error() !== undefined);
		expect(api.error()?.retryable).toBe(true);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("hello")),
		);
		api.retry();
		await settle(
			() => api.content() !== undefined && api.error() === undefined,
		);
		expect(api.content()?.text).toBe("hello");
		dispose();
	});
});
