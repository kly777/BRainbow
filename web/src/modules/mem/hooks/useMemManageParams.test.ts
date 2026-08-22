import { describe, expect, it, vi } from "vitest";
import { useMemManageParams } from "./useMemManageParams.ts";

// mock @solidjs/router 的 useSearchParams：可控的 [store, setter]
const mockSearchParams = vi.fn();
const mockSetSearchParams = vi.fn();

vi.mock("@solidjs/router", () => ({
	useSearchParams: () => [mockSearchParams(), mockSetSearchParams],
}));

// mock useUrlParams 的依赖（保持真实逻辑，仅替换底层信号）
function setupUrl(raw: Record<string, string>) {
	mockSearchParams.mockReturnValue(raw);
	mockSetSearchParams.mockClear();
}

describe("useMemManageParams detailId", () => {
	it("reads id from URL as number", () => {
		setupUrl({ id: "144" });
		const p = useMemManageParams();
		expect(p.detailId()).toBe(144);
	});

	it("returns null when id missing or invalid", () => {
		setupUrl({});
		expect(useMemManageParams().detailId()).toBeNull();

		setupUrl({ id: "abc" });
		expect(useMemManageParams().detailId()).toBeNull();

		setupUrl({ id: "0" });
		expect(useMemManageParams().detailId()).toBeNull();
	});

	it("setDetailId writes id string", () => {
		setupUrl({});
		const p = useMemManageParams();
		p.setDetailId(5);
		// useUrlParams.set({ id: 5 }) → id 描述器 write(5) = "5"
		expect(mockSetSearchParams).toHaveBeenCalledWith({ id: "5" });
	});

	it("setDetailId(null) removes id", () => {
		setupUrl({ id: "5" });
		const p = useMemManageParams();
		p.setDetailId(null);
		// id: undefined → setSearchParams 删除该参数
		expect(mockSetSearchParams).toHaveBeenCalledWith({ id: undefined });
	});
});

describe("useMemManageParams goToPage", () => {
	it("writes page and removes id", () => {
		setupUrl({ id: "144" });
		const p = useMemManageParams();
		p.goToPage(3);
		// 一次 patch：{ page: 3, id: undefined }
		expect(mockSetSearchParams).toHaveBeenCalledWith({
			page: "3",
			id: undefined,
		});
	});

	it("page stays in URL, id removed", () => {
		setupUrl({ id: "5", page: "2" });
		const p = useMemManageParams();
		p.goToPage(4);
		expect(mockSetSearchParams).toHaveBeenCalledWith({
			page: "4",
			id: undefined,
		});
	});
});

describe("useMemManageParams other params", () => {
	it("reads query params with defaults", () => {
		setupUrl({});
		const p = useMemManageParams();
		expect(p.searchQuery()).toBe("");
		expect(p.filterState()).toBe("all");
		expect(p.sortField()).toBe("due_at");
		expect(p.sortDir()).toBe("asc");
		expect(p.page()).toBe(1);
		expect(p.tagMode()).toBe("include");
	});

	it("reads explicit values", () => {
		setupUrl({ q: "hello", state: "review", sort: "difficulty", page: "3" });
		const p = useMemManageParams();
		expect(p.searchQuery()).toBe("hello");
		expect(p.filterState()).toBe("review");
		expect(p.sortField()).toBe("difficulty");
		expect(p.page()).toBe(3);
	});

	it("handleSearchInput resets page to 1", () => {
		setupUrl({});
		const p = useMemManageParams();
		p.handleSearchInput("x");
		expect(mockSetSearchParams).toHaveBeenCalledWith({
			q: "x",
			page: undefined,
		});
	});
});
