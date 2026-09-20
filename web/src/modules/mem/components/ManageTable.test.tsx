// ── ManageTable 渲染测试 ──
// 这个表格刚做过一次结构拆分（表头 / 行 / 骨架拆到 manage-table/，行级回调从
// 4 个嵌套接口收成一束 RowActions）。断言锁住拆分后的对外行为：
// 每行渲染线索/答案为预览文本、行内操作带着 id 回调、空态文案随筛选态变化、
// loading 时出骨架且不出表格。

import type { MemItem } from "@modules/mem";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import ManageTable from "./ManageTable.tsx";

// 空态里的"添加第一张记忆卡"是路由链接，渲染它需要 Router 上下文
vi.mock("@solidjs/router", () => ({
	A: (props: { children?: unknown; href?: string }) => (
		<a href={props.href}>{props.children as never}</a>
	),
}));

function mem(over: Partial<MemItem> = {}): MemItem {
	return {
		id: 7,
		cue: { content: "线索内容" },
		target: { content: "答案内容" },
		state: "review",
		due_at: "2026-09-01T00:00:00+00:00",
		difficulty: 5.5,
		leeched: false,
		...over,
	} as MemItem;
}

const baseProps = () => ({
	mems: [mem()],
	batchIds: new Set<number>(),
	sortField: "state" as const,
	sortDir: "asc" as const,
	detailId: null as number | null,
	memTags: new Map(),
	allSelected: false,
	loading: false,
	pageMeta: { page: 1, total_pages: 1, total: 1 },
	page: 1,
	filtered: false,
	onToggleSort: () => {},
	onToggleBatch: () => {},
	onToggleAll: () => {},
	onSelectRow: () => {},
	onDelete: () => {},
	onPageChange: () => {},
});

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("ManageTable", () => {
	it("渲染表头与每行的线索/答案预览", () => {
		const host = mount(() => <ManageTable {...baseProps()} />);
		expect(host.textContent).toContain("线索");
		expect(host.textContent).toContain("答案");
		expect(host.textContent).toContain("线索内容");
		expect(host.textContent).toContain("答案内容");
		expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
	});

	it("点线索单元格带着该行 id 回调 onSelectRow", () => {
		const onSelectRow = vi.fn();
		const host = mount(() => (
			<ManageTable {...baseProps()} onSelectRow={onSelectRow} />
		));
		const cell = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("线索内容"),
		) as HTMLButtonElement;
		cell.click();
		expect(onSelectRow).toHaveBeenCalledWith(7);
	});

	it("删除按钮带着该行 id 回调 onDelete", () => {
		const onDelete = vi.fn();
		const host = mount(() => (
			<ManageTable {...baseProps()} onDelete={onDelete} />
		));
		const del = host.querySelector("button[title='删除']") as HTMLButtonElement;
		del.click();
		expect(onDelete).toHaveBeenCalledWith(7);
	});

	it("已选行渲染出勾选状态", () => {
		const host = mount(() => (
			<ManageTable {...baseProps()} batchIds={new Set([7])} />
		));
		const boxes = host.querySelectorAll(
			"input[type='checkbox']",
		) as NodeListOf<HTMLInputElement>;
		// 第一个是全选，第二个是该行
		expect(boxes[1].checked).toBe(true);
	});

	it("无数据时给空态；筛选态与首次进入的文案不同", () => {
		const plain = mount(() => <ManageTable {...baseProps()} mems={[]} />);
		expect(plain.textContent).toContain("档案柜还是空的");
		expect(plain.textContent).toContain("添加第一张记忆卡");

		const filtered = mount(() => (
			<ManageTable {...baseProps()} mems={[]} filtered />
		));
		expect(filtered.textContent).toContain("没有匹配的记忆");
	});

	it("loading 时渲染骨架屏而不是表格", () => {
		const host = mount(() => <ManageTable {...baseProps()} loading />);
		expect(host.querySelector("table")).toBeNull();
		expect(host.querySelector('[role="status"]')).toBeTruthy();
	});
});
