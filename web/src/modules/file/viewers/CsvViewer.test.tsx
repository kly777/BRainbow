// ── CsvViewer：大表分批载入（不再"只给 500 行、剩下的下载看"） ──
//
// 数据本来就在内存里（TextContent 已把 4MB 段取回来），往下多渲染几行是纯前端的事。
// 但一次性渲染十万行会卡死浏览器 —— 那正是当初设上限的原因，所以：
// 「全部展开」只在小表上出现，大表只能一批批翻。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CsvViewer } from "./CsvViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

/** 造 n 行的 CSV（每行 2 列，行号可辨认） */
const csvOf = (n: number) =>
	Array.from({ length: n }, (_, i) => `r${i},v${i}`).join("\n");

function mount(text: string) {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(text)),
	);
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<CsvViewer
				item={item({ mime_type: "text/csv", original_name: "t.csv" })}
			/>
		),
		host,
	);
	return host;
}

const rowCount = (host: HTMLElement) =>
	host.querySelectorAll("tbody tr").length;
const buttonWith = (host: HTMLElement, label: string) =>
	Array.from(host.querySelectorAll("button")).find((b) =>
		(b.textContent ?? "").includes(label),
	);

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("CsvViewer 分批载入", () => {
	it("首行进表头（粘顶），行数只算数据行", async () => {
		const host = mount(csvOf(10));
		await settle(() => rowCount(host) === 9);
		// 10 行文件 = 1 行表头 + 9 行数据
		expect(rowCount(host)).toBe(9);
		expect(host.querySelectorAll("thead th")).toHaveLength(2);
		expect(host.querySelector("thead")?.textContent).toContain("r0");
		expect(buttonWith(host, "载入更多")).toBeUndefined();
		expect(host.textContent).not.toContain("已显示");
	});

	it("大表首屏 500 个数据行 + 载入更多（每次追加 500）", async () => {
		const host = mount(csvOf(1200));
		await settle(() => rowCount(host) === 500);
		expect(rowCount(host)).toBe(500);
		expect(host.textContent).toContain("已显示 500 / 1199 行");

		buttonWith(host, "载入更多")?.click();
		await settle(() => rowCount(host) === 1000);
		expect(rowCount(host)).toBe(1000);
		expect(host.textContent).toContain("已显示 1000 / 1199 行");

		buttonWith(host, "载入更多")?.click();
		await settle(() => rowCount(host) === 1199);
		expect(host.textContent).not.toContain("已显示");
	});

	it("小表可全部展开；大表不给这个按钮（一次性渲染会卡死）", async () => {
		const host = mount(csvOf(900));
		await settle(() => rowCount(host) === 500);
		expect(buttonWith(host, "全部展开")).toBeDefined();
		buttonWith(host, "全部展开")?.click();
		await settle(() => rowCount(host) === 899);
		expect(rowCount(host)).toBe(899);

		// 超过阈值的大表：只能一批批翻
		const big = mount(csvOf(9000));
		await settle(() => rowCount(big) === 500);
		expect(buttonWith(big, "载入更多")).toBeDefined();
		expect(buttonWith(big, "全部展开")).toBeUndefined();
	});
});
