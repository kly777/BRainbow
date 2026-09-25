// ── SearchInput 契约测试 ──
// 此前只断言 `typeof SearchInput === "function"`。这里钉住它的全部价值所在：
// 受控 + 防抖（窗口内连续输入只回调最后一次、trim 后回调、卸载即取消）。

import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchInput from "./SearchInput.tsx";

const input = () => document.querySelector("input") as HTMLInputElement;

function type(value: string) {
	const el = input();
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

function mount(ui: () => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	return render(ui, host);
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("SearchInput", () => {
	it("渲染为 type=search，默认 placeholder 与可访问名都是「搜索」", () => {
		mount(() => <SearchInput value="" onSearch={() => {}} />);
		expect(input().type).toBe("search");
		expect(input().placeholder).toBe("搜索…");
		expect(input().getAttribute("aria-label")).toBe("搜索");
	});

	it("placeholder 同时作为可访问名", () => {
		mount(() => (
			<SearchInput value="" onSearch={() => {}} placeholder="搜索文件名…" />
		));
		expect(input().placeholder).toBe("搜索文件名…");
		expect(input().getAttribute("aria-label")).toBe("搜索文件名…");
	});

	it("输入立刻反映到输入框，防抖后才 trim 并回调", () => {
		const onSearch = vi.fn();
		mount(() => <SearchInput value="" onSearch={onSearch} debounceMs={50} />);

		type("  hello ");
		expect(input().value).toBe("  hello ");
		expect(onSearch).not.toHaveBeenCalled();

		vi.advanceTimersByTime(60);
		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onSearch).toHaveBeenCalledWith("hello");
	});

	it("防抖窗口内连续输入只回调最后一次", () => {
		const onSearch = vi.fn();
		mount(() => <SearchInput value="" onSearch={onSearch} debounceMs={50} />);

		type("a");
		vi.advanceTimersByTime(20);
		type("ab");
		vi.advanceTimersByTime(20);
		type("abc");
		vi.advanceTimersByTime(60);

		expect(onSearch).toHaveBeenCalledTimes(1);
		expect(onSearch).toHaveBeenCalledWith("abc");
	});

	it("外部 value 变化同步到输入框（外部清空搜索能反映出来）", async () => {
		const [value, setValue] = createSignal("初始");
		mount(() => <SearchInput value={value()} onSearch={() => {}} />);
		expect(input().value).toBe("初始");

		setValue("");
		await Promise.resolve(); // 让 Solid 的 effect 落地
		expect(input().value).toBe("");
	});

	it("卸载时取消未触发的防抖（不对已离开的输入框回调）", () => {
		const onSearch = vi.fn();
		const dispose = mount(() => (
			<SearchInput value="" onSearch={onSearch} debounceMs={50} />
		));

		type("late");
		dispose();
		vi.advanceTimersByTime(200);

		expect(onSearch).not.toHaveBeenCalled();
	});
});
