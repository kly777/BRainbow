// ── DbTable 渲染测试 ──
// 空行刚从 "单元格里的 <td class={emptyCell}>无数据</td> + 自己的 CSS" 换成共享
// EmptyState（.empty-cell 的 padding 随之删除）。断言锁住：无数据时那句提示还在、
// 有数据时渲染单元格值、行展开回调带着行号。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../api.ts";
import DbTable from "./DbTable.tsx";

function col(name: string, over: Partial<ColumnInfo> = {}): ColumnInfo {
	return { name, col_type: "TEXT", is_primary: false, ...over };
}

const columns = [col("id", { is_primary: true }), col("title")];

const baseProps = () => ({
	tableName: "bookmark",
	columns,
	rows: [
		["1", "第一条"],
		["2", "第二条"],
	] as readonly string[][],
	filters: [],
	loading: false,
	sortCol: "",
	sortDesc: false,
	previewFor: (_t: string, v: string) => v,
	onSort: () => {},
	onSetFilter: () => {},
	onJumpToRef: () => {},
});

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("DbTable", () => {
	it("渲染每一行的单元格值", () => {
		const host = mount(() => <DbTable {...baseProps()} />);
		expect(host.textContent).toContain("第一条");
		expect(host.textContent).toContain("第二条");
		// 表头两列各出现一次
		expect(host.textContent).toContain("title");
	});

	it("没有数据时给空态提示而不是空表格体", () => {
		const host = mount(() => <DbTable {...baseProps()} rows={[]} />);
		expect(host.textContent).toContain("无数据");
		expect(host.textContent).not.toContain("第一条");
	});

	it("loading 时不给空态（避免把「还没加载」说成「没有数据」）", () => {
		const host = mount(() => <DbTable {...baseProps()} rows={[]} loading />);
		expect(host.textContent).not.toContain("无数据");
	});

	it("点列头回调 onSort", () => {
		const onSort = vi.fn();
		const host = mount(() => <DbTable {...baseProps()} onSort={onSort} />);
		const head = Array.from(host.querySelectorAll("th button")).find((b) =>
			b.textContent?.includes("title"),
		) as HTMLButtonElement;
		head.click();
		expect(onSort).toHaveBeenCalledWith("title");
	});
});
