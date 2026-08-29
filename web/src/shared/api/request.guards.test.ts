// ── request.ts 守卫层与 streaming.ts 边界测试（审计 T2） ──
// 每个用例通过 vi.resetModules + 动态 import 获取独立模块实例，
// 隔离 _authFiredAt（401 弹窗 3s 去重）与 token.ts 内存缓存等模块态。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 全局 mock showToast 避免动态 import @components/ui 挂起
vi.mock("@components/ui", () => ({
	showToast: vi.fn(),
}));

async function freshRequestModule() {
	vi.resetModules();
	// 重新 mock 以确保每个测试用例独立
	vi.doMock("@components/ui", () => ({ showToast: vi.fn() }));
	return import("./request.ts");
}

async function freshStreamingModule() {
	vi.resetModules();
	vi.doMock("@components/ui", () => ({ showToast: vi.fn() }));
	return import("./streaming.ts");
}

const USER = JSON.stringify({
	id: 1,
	name: "qa",
	role: "user",
	token: "tok-abc",
});

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("buildHeaders 凭证与 Content-Type 规则", () => {
	it("无 body 不设 Content-Type", async () => {
		const { buildHeaders } = await freshRequestModule();
		expect(buildHeaders().has("Content-Type")).toBe(false);
	});

	it("JSON body 设 application/json；FormData 交给浏览器设 boundary", async () => {
		const { buildHeaders } = await freshRequestModule();
		expect(
			buildHeaders(undefined, JSON.stringify({ a: 1 })).get("Content-Type"),
		).toBe("application/json");
		const fd = new FormData();
		fd.append("f", "1");
		expect(buildHeaders(undefined, fd).has("Content-Type")).toBe(false);
	});

	it("token 与 API Key 互斥：有 token 不再带 X-API-Key", async () => {
		localStorage.setItem("brainbow_user", USER);
		localStorage.setItem("brainbow_api_key", "key-123");
		const { buildHeaders } = await freshRequestModule();
		const h = buildHeaders();
		expect(h.get("Authorization")).toBe("Bearer tok-abc");
		expect(h.has("X-API-Key")).toBe(false);
	});

	it("仅 API Key 时带 X-API-Key 且无 Authorization", async () => {
		localStorage.setItem("brainbow_api_key", "key-123");
		const { buildHeaders } = await freshRequestModule();
		const h = buildHeaders();
		expect(h.get("X-API-Key")).toBe("key-123");
		expect(h.has("Authorization")).toBe(false);
	});
});

describe("handleGlobalError 副作用链", () => {
	it("401 派发 auth:required 事件；3 秒内并发 401 去重不重复派发", async () => {
		let fired = 0;
		const handler = () => fired++;
		globalThis.addEventListener("auth:required", handler);
		try {
			const { handleGlobalError } = await freshRequestModule();
			const err = {
				status: 401,
				code: "UNAUTHORIZED",
				message: "x",
				details: undefined,
			};
			await handleGlobalError("/api/x", err as never);
			await handleGlobalError("/api/y", err as never); // 3s 去重窗口内
			expect(fired).toBe(1);
		} finally {
			globalThis.removeEventListener("auth:required", handler);
		}
	});

	it("403 不触发登录弹窗事件", async () => {
		let fired = 0;
		const handler = () => fired++;
		globalThis.addEventListener("auth:required", handler);
		try {
			const { handleGlobalError } = await freshRequestModule();
			await handleGlobalError("/api/x", {
				status: 403,
				code: "FORBIDDEN",
				message: "x",
				details: undefined,
			} as never);
			expect(fired).toBe(0);
		} finally {
			globalThis.removeEventListener("auth:required", handler);
		}
	});
});

describe("streamRequest 解析边界", () => {
	function sseResponse(chunks: string[]): Response {
		const encoder = new TextEncoder();
		let i = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
				else controller.close();
			},
		});
		return new Response(stream, { status: 200 });
	}

	it("跨 chunk 断行正确拼回完整 data 行", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				// 断点落在行中间：token "hello"/"world" 均跨 chunk
				sseResponse(["data: hel", "lo\n\ndata: wor", "ld\n\n"]),
			),
		);
		const { streamRequest } = await freshStreamingModule();
		const got: string[] = [];
		await streamRequest({ endpoint: "/x", onChunk: (c) => got.push(c) });
		expect(got).toEqual(["hello", "world"]);
	});

	it("data: 后无空格也解析（SSE 规范只去一个空格）", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => sseResponse(["data:nospace\n\n"])),
		);
		const { streamRequest } = await freshStreamingModule();
		const got: string[] = [];
		await streamRequest({ endpoint: "/x", onChunk: (c) => got.push(c) });
		expect(got).toEqual(["nospace"]);
	});

	it("非 ok 响应走全局错误处理并抛 HttpError（401 弹登录）", async () => {
		let fired = 0;
		const handler = () => fired++;
		globalThis.addEventListener("auth:required", handler);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(JSON.stringify({ code: "UNAUTHORIZED", message: "x" }), {
						status: 401,
					}),
			),
		);
		try {
			const mod = await freshStreamingModule();
			await expect(
				mod.streamRequest({ endpoint: "/x", onChunk: () => {} }),
			).rejects.toMatchObject({ status: 401 });
			expect(fired).toBe(1);
		} finally {
			globalThis.removeEventListener("auth:required", handler);
		}
	});
});
