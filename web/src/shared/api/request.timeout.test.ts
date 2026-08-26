import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@components/ui", () => ({ showToast: vi.fn() }));

import { request } from "./request.ts";

/** 模拟一个只在 signal abort 时才拒绝的 fetch，用于验证超时/取消行为 */
function pendingFetch(): ReturnType<typeof vi.fn> {
	return vi.fn(
		(_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					const err = new Error("aborted");
					err.name = "AbortError";
					reject(err);
				});
			}),
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("request timeout", () => {
	it("默认 15s 超时：超时后以明确的超时错误失败", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", pendingFetch());

		const pending = request("/slow");
		const assertion = expect(pending).rejects.toMatchObject({
			canceled: false,
			message: "请求超时，请稍后重试",
		});
		await vi.advanceTimersByTimeAsync(15_000);
		await assertion;
	});

	it("支持自定义 timeout 毫秒数", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", pendingFetch());

		const pending = request("/custom", { timeout: 100 });
		const assertion = expect(pending).rejects.toMatchObject({
			message: "请求超时，请稍后重试",
		});
		await vi.advanceTimersByTimeAsync(99);
		await vi.advanceTimersByTimeAsync(1);
		await assertion;
	});

	it("外部 signal 主动取消仍标记为 canceled", async () => {
		vi.useFakeTimers();
		vi.stubGlobal("fetch", pendingFetch());
		const controller = new AbortController();

		const pending = request("/cancel", { signal: controller.signal });
		const assertion = expect(pending).rejects.toMatchObject({ canceled: true });
		controller.abort();
		await assertion;
	});

	it("timeout: false 关闭默认超时", async () => {
		vi.useFakeTimers();
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response(null, { status: 204 }));
		vi.stubGlobal("fetch", fetchMock);

		const pending = request("/no-timeout", { timeout: false });
		// 即使推进超过默认超时，也不应触发 abort；204 正常返回 undefined
		await vi.advanceTimersByTimeAsync(60_000);
		await expect(pending).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledOnce();
	});
});
