// ── usePreviewUrl：私密文件换 blob，公开文件直通 ──

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePreviewUrl } from "./usePreviewUrl.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 在响应式根里挂载 hook：effect 要等一次微任务才跑，
 * 所以支持读值和清理分开（提前 dispose 会让 effect 根本不执行）。
 */
function mount<T>(fn: () => T): { read: () => T; dispose: () => void } {
	let value!: T;
	let dispose!: () => void;
	createRoot((d) => {
		dispose = d;
		value = fn();
	});
	return { read: () => value, dispose };
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("usePreviewUrl", () => {
	it("公开文件直接返回原 URL，不发请求", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const { read, dispose } = mount(() =>
			usePreviewUrl(
				() => "/api/file/abc/data/a.png",
				() => false,
			),
		);
		await tick();
		expect(read()()).toBe("/api/file/abc/data/a.png");
		expect(fetchSpy).not.toHaveBeenCalled();
		dispose();
	});

	it("私密文件带凭据 fetch 后返回 blob URL，并在清理时回收", async () => {
		const createObjectURL = vi.fn(() => "blob:fake-url");
		const revokeObjectURL = vi.fn();
		Object.assign(URL, { createObjectURL, revokeObjectURL });

		const blob = new Blob(["data"], { type: "image/png" });
		const fetchSpy = vi.fn().mockResolvedValue({
			ok: true,
			blob: async () => blob,
		});
		vi.stubGlobal("fetch", fetchSpy);

		let url!: () => string | undefined;
		let dispose!: () => void;
		createRoot((d) => {
			dispose = d;
			url = usePreviewUrl(
				() => "/api/file/abc/data/secret.png",
				() => true,
			);
		});

		// 加载中：暂无可用 URL
		expect(url()).toBeUndefined();
		await tick();
		expect(url()).toBe("blob:fake-url");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/file/abc/data/secret.png",
			expect.objectContaining({ headers: expect.anything() }),
		);

		dispose();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
	});

	it("私密文件加载失败时不返回 URL（不渲染破图）", async () => {
		Object.assign(URL, { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue({ ok: false, status: 401, blob: async () => null }),
		);

		const { read, dispose } = mount(() =>
			usePreviewUrl(
				() => "/api/file/abc/data/secret.png",
				() => true,
			),
		);
		await tick();
		expect(read()()).toBeUndefined();
		dispose();
	});
});
