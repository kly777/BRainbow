// ── .ply 内容获取：Range 探头部 → 按大小决定取不取整包 ──
// 这组断言钉的是"与后端 Range 的约定"：Content-Range 的 /total 决定要不要继续下载。

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileItem } from "../api.ts";
import {
	__internal,
	MAX_PLY_BYTES,
	type PlyPhase,
	totalFromContentRange,
	usePreviewPly,
} from "./usePreviewPly.ts";

const { fetchPly, PROBE_BYTES } = __internal;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const item: FileItem = {
	id: 1,
	stored_id: "s1",
	url: "/api/file/s1/data/场景.ply",
	original_name: "场景.ply",
	mime_type: "application/octet-stream",
	file_category: "other",
	size_bytes: 2048,
	width: null,
	height: null,
	duration_ms: null,
	tags: [],
	meta: {},
	created_at: "2026-09-14T00:00:00+00:00",
	updated_at: "2026-09-14T00:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
};

/** 带 Content-Range 的分段响应 */
const partial = (body: Uint8Array, total: number) =>
	new Response(body.buffer as ArrayBuffer, {
		status: 206,
		headers: { "content-range": `bytes 0-${body.length - 1}/${total}` },
	});

/** 让 vi.fn 的签名带上参数，测试里才能检查第二个参数的 headers */
type FetchArgs = [url: string, init?: RequestInit];
const fetchStub = (
	impl: (url: string, init?: RequestInit) => Promise<Response>,
) => vi.fn<(...args: FetchArgs) => Promise<Response>>(impl);

const signal = () => new AbortController().signal;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("totalFromContentRange", () => {
	it("取出 / 后面的总大小", () => {
		expect(totalFromContentRange("bytes 0-65535/123456")).toBe(123456);
	});

	it("没有这个头时返回 undefined（服务端忽略了 Range）", () => {
		expect(totalFromContentRange(null)).toBeUndefined();
		expect(totalFromContentRange("bytes */0")).toBe(0);
	});
});

describe("fetchPly", () => {
	it("先用 Range 探头部；文件比分段小则一次响应就够，不再发第二个请求", async () => {
		const body = new Uint8Array(PROBE_BYTES / 2).fill(7);
		const fetchSpy = fetchStub(async () => partial(body, body.length));
		vi.stubGlobal("fetch", fetchSpy);

		const result = await fetchPly(item, MAX_PLY_BYTES, signal());
		expect(result.kind).toBe("ready");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
		expect((init.headers as Record<string, string>).Range).toBe(
			`bytes=0-${PROBE_BYTES - 1}`,
		);
		if (result.kind === "ready") expect(result.bytes.length).toBe(body.length);
	});

	it("文件大于分段时再整包拉一次，且第二次不带 Range", async () => {
		const head = new Uint8Array(PROBE_BYTES).fill(1);
		const full = new Uint8Array(PROBE_BYTES * 3).fill(1);
		const fetchSpy = vi
			.fn<(...args: FetchArgs) => Promise<Response>>()
			.mockResolvedValueOnce(partial(head, full.length))
			.mockResolvedValueOnce(new Response(full.buffer as ArrayBuffer));
		vi.stubGlobal("fetch", fetchSpy);

		const result = await fetchPly(item, MAX_PLY_BYTES, signal());
		expect(fetchSpy).toHaveBeenCalledTimes(2);
		const secondHeaders = fetchSpy.mock.calls[1]?.[1]?.headers as
			| Record<string, string>
			| undefined;
		expect(secondHeaders?.Range).toBeUndefined();
		if (result.kind === "ready") expect(result.bytes.length).toBe(full.length);
	});

	it("把加载阶段报给调用方（探测 → 下载 N 字节），供「正在下载…」文案用", async () => {
		const head = new Uint8Array(PROBE_BYTES).fill(1);
		const full = new Uint8Array(PROBE_BYTES * 3).fill(1);
		vi.stubGlobal(
			"fetch",
			vi
				.fn<(...args: FetchArgs) => Promise<Response>>()
				.mockResolvedValueOnce(partial(head, full.length))
				.mockResolvedValueOnce(new Response(full.buffer as ArrayBuffer)),
		);

		const phases: PlyPhase[] = [];
		await fetchPly(item, MAX_PLY_BYTES, signal(), 30_000, (p) =>
			phases.push(p),
		);

		expect(phases).toEqual([
			{ kind: "probing" },
			{ kind: "downloading", sizeBytes: full.length },
		]);
	});

	it("超过上限时只探一次就收手（不下载整包）", async () => {
		const fetchSpy = fetchStub(async () =>
			partial(new Uint8Array(1024), 1 << 30),
		);
		vi.stubGlobal("fetch", fetchSpy);

		const result = await fetchPly(item, MAX_PLY_BYTES, signal());
		expect(result).toEqual({ kind: "too-large", sizeBytes: 1 << 30 });
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it("服务端忽略 Range（200 无 Content-Range）时用响应长度判断", async () => {
		const body = new Uint8Array(4096).fill(3);
		vi.stubGlobal(
			"fetch",
			fetchStub(async () => new Response(body.buffer as ArrayBuffer)),
		);
		const result = await fetchPly(item, MAX_PLY_BYTES, signal());
		expect(result.kind).toBe("ready");
		if (result.kind === "ready") expect(result.sizeBytes).toBe(4096);
	});

	it("HTTP 错误与网络异常都变成可读的失败态，不抛穿", async () => {
		vi.stubGlobal(
			"fetch",
			fetchStub(async () => new Response("nope", { status: 404 })),
		);
		expect((await fetchPly(item, MAX_PLY_BYTES, signal())).kind).toBe("failed");

		vi.stubGlobal(
			"fetch",
			fetchStub(async () => {
				throw new Error("断网了");
			}),
		);
		const failed = await fetchPly(item, MAX_PLY_BYTES, signal());
		expect(failed.kind).toBe("failed");
		if (failed.kind === "failed") expect(failed.message).toContain("断网了");
	});
});

describe("usePreviewPly", () => {
	it("挂载后给出加载结果（响应式跟随文件）", async () => {
		const body = new Uint8Array(2048).fill(9);
		vi.stubGlobal(
			"fetch",
			fetchStub(async () => partial(body, body.length)),
		);

		let state!: () => { kind: string } | undefined;
		let dispose!: () => void;
		createRoot((d) => {
			dispose = d;
			state = usePreviewPly(() => item);
		});
		await tick();
		await tick();
		expect(state()?.kind).toBe("ready");
		dispose();
	});
});
