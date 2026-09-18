// ── DataTable：表头粘顶 + 点击复制单元格 ──
//
// 这个组件是三处表格预览（CSV / XLSX / SQLite）**唯一**的表格实现，所以它的两条
// 交互在这里钉住就够了：表头进 `<thead>`（CSS 让它粘顶）、点单元格复制其文本并给反馈。

import { copyText } from "@shared/utils";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable } from "./DataTable.tsx";

vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return { ...actual, copyText: vi.fn() };
});

function mount(props: Parameters<typeof DataTable>[0]) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <DataTable {...props} />, host);
	return host;
}

const cells = (host: HTMLElement) =>
	Array.from(host.querySelectorAll("td")) as HTMLTableCellElement[];

afterEach(() => {
	vi.clearAllMocks();
});

describe("DataTable", () => {
	it("给了表头就渲染 thead（CSS 负责粘顶），没有就不渲染表头", () => {
		const withHead = mount({ head: ["名", "量"], rows: [["a", "1"]] });
		expect(withHead.querySelectorAll("thead th")).toHaveLength(2);
		expect(withHead.querySelector("thead")?.textContent).toBe("名量");

		const withoutHead = mount({ rows: [["a", "1"]] });
		expect(withoutHead.querySelector("thead")).toBeNull();
		expect(withoutHead.querySelectorAll("td")).toHaveLength(2);
	});

	it("点单元格复制它的文本，并给一闪的反馈", async () => {
		const host = mount({ rows: [["alpha", "beta"]] });
		const [first, second] = cells(host);
		expect(first.dataset.copied).toBeUndefined();

		second.click();
		expect(vi.mocked(copyText)).toHaveBeenCalledWith("beta");
		expect(cells(host)[1].dataset.copied).toBe("true");
		// 只标记被点的那一格
		expect(cells(host)[0].dataset.copied).toBeUndefined();
	});

	it("换一格复制时，上一格的高亮立刻撤掉", () => {
		const host = mount({ rows: [["a", "b"]] });
		cells(host)[0].click();
		expect(cells(host)[0].dataset.copied).toBe("true");

		cells(host)[1].click();
		expect(cells(host)[1].dataset.copied).toBe("true");
		expect(cells(host)[0].dataset.copied).toBeUndefined();
	});

	it("两种变体的单元格 class 不同（CSV 强调首列，表格/数据库等权）", () => {
		const csv = mount({ head: ["h"], rows: [["v"]], variant: "csv" });
		const sheet = mount({ head: ["h"], rows: [["v"]], variant: "sheet" });
		expect(cells(csv)[0].className).not.toBe(cells(sheet)[0].className);
	});
});
