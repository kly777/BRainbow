import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vite-plus/test";
import { useMutation } from "./useMutation.ts";

function mount<T>(fn: () => T): T {
	let result!: T;
	const dispose = createRoot((disposeFn) => {
		result = fn();
		return disposeFn;
	});
	dispose();
	return result;
}

describe("useMutation", () => {
	it("成功：置 pending、调用 invalidate 与 onSuccess", async () => {
		const invalidate = vi.fn();
		const onSuccess = vi.fn();
		const mutation = mount(() =>
			useMutation({
				run: async (value: number) => value * 2,
				invalidate,
				onSuccess,
			}),
		);

		const promise = mutation.run(3);
		expect(mutation.pending()).toBe(true);
		const result = await promise;
		expect(result).toEqual({ ok: true, value: 6 });
		expect(invalidate).toHaveBeenCalledWith(6, 3);
		expect(onSuccess).toHaveBeenCalledWith(6, 3);
		expect(mutation.pending()).toBe(false);
		expect(mutation.error()).toBeNull();
	});

	it("失败：保留错误并调用 onError，不调用成功回调", async () => {
		const onSuccess = vi.fn();
		const onError = vi.fn();
		const error = new Error("boom");
		const mutation = mount(() =>
			useMutation({
				run: async () => {
					throw error;
				},
				onSuccess,
				onError,
			}),
		);

		const result = await mutation.run(undefined);
		expect(result.ok).toBe(false);
		expect(onSuccess).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(error, undefined);
		expect(mutation.pending()).toBe(false);
		expect(mutation.error()).toBe(error);
	});

	it("reset 清掉错误", async () => {
		const mutation = mount(() =>
			useMutation({
				run: async () => {
					throw new Error("boom");
				},
			}),
		);
		await mutation.run(undefined);
		expect(mutation.error()).not.toBeNull();
		mutation.reset();
		expect(mutation.error()).toBeNull();
	});
});
