import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./timing.ts";

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe("debounce", () => {
	it("静默期满后只执行最后一次调用", () => {
		const fn = vi.fn();
		const run = debounce(fn, 300);
		run("a");
		vi.advanceTimersByTime(200);
		run("b");
		vi.advanceTimersByTime(299);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("b");
	});

	it("cancel 后不再执行", () => {
		const fn = vi.fn();
		const run = debounce(fn, 300);
		run("x");
		run.cancel();
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
	});

	it("默认等待 SEARCH_DEBOUNCE_MS(300ms)", () => {
		const fn = vi.fn();
		const run = debounce(fn);
		run();
		vi.advanceTimersByTime(299);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
