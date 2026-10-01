// @vitest-environment jsdom
// ── usePaletteSearch：输入法闸门 ──
//
// 立项背景（中文用户真实症状）：`?` 模式下打拼音，每个中间态都会触发一次搜索 ——
// 既白费请求，也会让"搜索中…"把列表清空重画一次。组字期间只该等，compositionend
// 拿到最终文本再搜。

import { SEARCH_DEBOUNCE_MS } from "@shared/utils/timing.ts";
import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchE } from "../api.ts";
import type { Mode } from "./usePalette.ts";
import { usePaletteSearch } from "./usePaletteSearch.ts";

vi.mock("../api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api.ts")>();
	return { ...actual, searchE: vi.fn() };
});

const mockedSearch = vi.mocked(searchE);

const DEBOUNCE = SEARCH_DEBOUNCE_MS;

function setup() {
	// 只有 `?` 模式会触发搜索，这组用例固定在该模式（要切换时再暴露 setMode）
	const [mode] = createSignal<Mode>("search");
	const [query, setQuery] = createSignal("");
	const [composing, setComposing] = createSignal(false);
	let api!: ReturnType<typeof usePaletteSearch>;
	const dispose = createRoot((dispose) => {
		api = usePaletteSearch({
			mode,
			query,
			composing,
			setQuery: (v) => setQuery(v),
			navigate: () => {},
			close: () => {},
		});
		return dispose;
	});
	return { api, setQuery, setComposing, dispose };
}

beforeEach(() => {
	vi.useFakeTimers();
	mockedSearch.mockResolvedValue({ hits: [] } as never);
});
afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("usePaletteSearch 的输入法闸门", () => {
	it("组字中不发请求；compositionend（composing 落回 false）才按最终文本搜", async () => {
		const { setQuery, setComposing, dispose } = setup();

		setComposing(true);
		setQuery("hui");
		await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
		setQuery("huiyi");
		await vi.advanceTimersByTimeAsync(DEBOUNCE * 3);
		expect(mockedSearch).not.toHaveBeenCalled();

		setComposing(false);
		await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
		expect(mockedSearch).toHaveBeenCalledTimes(1);
		expect(mockedSearch).toHaveBeenCalledWith("huiyi");

		dispose();
	});

	it("不组字时照常防抖搜索（闸门没把正常路径堵死）", async () => {
		const { setQuery, dispose } = setup();

		setQuery("会议");
		await vi.advanceTimersByTimeAsync(DEBOUNCE * 2);
		expect(mockedSearch).toHaveBeenCalledTimes(1);
		expect(mockedSearch).toHaveBeenCalledWith("会议");

		dispose();
	});
});
