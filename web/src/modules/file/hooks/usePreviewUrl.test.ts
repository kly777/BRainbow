// ── usePreviewUrl：私密文件换 blob，公开文件直通 ──

import { createRoot } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PreviewUrlState, usePreviewUrl } from "./usePreviewUrl.ts";

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
		expect(read().url()).toBe("/api/file/abc/data/a.png");
		expect(read().error()).toBeUndefined();
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

		let state!: PreviewUrlState;
		let dispose!: () => void;
		createRoot((d) => {
			dispose = d;
			state = usePreviewUrl(
				() => "/api/file/abc/data/secret.png",
				() => true,
			);
		});

		// 加载中：暂无可用 URL
		expect(state.url()).toBeUndefined();
		await tick();
		expect(state.url()).toBe("blob:fake-url");
		expect(fetchSpy).toHaveBeenCalledWith(
			"/api/file/abc/data/secret.png",
			expect.objectContaining({ headers: expect.anything() }),
		);

		dispose();
		expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
	});

	it("换 blob 失败时给出可重试的错误（不再永远停在『正在加载』）", async () => {
		Object.assign(URL, { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() });
		const fetchSpy = vi
			.fn()
			.mockResolvedValue({ ok: false, status: 503, blob: async () => null });
		vi.stubGlobal("fetch", fetchSpy);

		const { read, dispose } = mount(() =>
			usePreviewUrl(
				() => "/api/file/abc/data/secret.png",
				() => true,
			),
		);
		await tick();
		expect(read().url()).toBeUndefined();
		// 5xx 属于"换个时刻再试会不一样"，所以可重试
		expect(read().error()?.retryable).toBe(true);
		expect(read().error()?.message).toContain("503");

		// 重试会重新发请求；这次成功
		fetchSpy.mockResolvedValue({ ok: true, blob: async () => new Blob(["x"]) });
		read().retry();
		await tick();
		await tick();
		expect(read().error()).toBeUndefined();
		dispose();
	});

	it("401 这类不该重试的错误不给重试按钮", async () => {
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
		expect(read().error()?.retryable).toBe(false);
		dispose();
	});
});
