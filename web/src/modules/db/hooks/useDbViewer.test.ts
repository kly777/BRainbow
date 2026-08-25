import { describe, expect, it, vi } from "vitest";
import { useDbViewer } from "./useDbViewer.ts";

// mock @solidjs/router 的 useSearchParams：可控的 [store, setter]
const mockSearchParams = vi.fn<() => Record<string, unknown>>();
const mockSetSearchParams = vi.fn();

vi.mock("@solidjs/router", () => ({
	useSearchParams: () => [mockSearchParams(), mockSetSearchParams],
}));

// mock 网络 API：本测试只关注 URL 参数写入，不关心数据形状
vi.mock("../api.ts", () => ({
	getTablesE: () => Promise.resolve([]),
	getTableDataE: () =>
		Promise.resolve({ header: [], rows: [], total: 0, refs: [] }),
	downloadTableExport: () => Promise.resolve(new Blob()),
}));

function setupUrl(raw: Record<string, unknown>) {
	mockSearchParams.mockReturnValue(raw);
	mockSetSearchParams.mockClear();
}

describe("useDbViewer filters", () => {
	it("reads column filters and ref filter from URL", () => {
		setupUrl({
			table: "cards",
			id: "5",
			ref_col: "card_id",
			fcol: ["name", "note"],
			fop: ["contains", "null"],
			fval: ["abc", ""],
		});
		const m = useDbViewer();
		expect(m.filters()).toEqual([
			{ col: "name", op: "contains", val: "abc" },
			{ col: "note", op: "null", val: "" },
		]);
		expect(m.refFilter()).toEqual({ col: "card_id", id: 5 });
		expect(m.hasFilters()).toBe(true);
	});

	it("clearFilters removes column filters AND the ref jump (id/ref_col)", () => {
		setupUrl({
			table: "cards",
			page: "3",
			id: "5",
			ref_col: "card_id",
			fcol: "name",
			fop: "contains",
			fval: "abc",
		});
		const m = useDbViewer();
		m.clearFilters();
		// 回归：ref 过滤（外键跳转）也必须一并清除，否则"清除过滤"无效
		expect(mockSetSearchParams).toHaveBeenCalledWith({
			page: 1,
			id: undefined,
			ref_col: undefined,
			fcol: undefined,
			fop: undefined,
			fval: undefined,
		});
	});
});
