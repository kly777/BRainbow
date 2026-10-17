// ── TaskMeta / TaskItem / TaskEmpty 渲染测试 ──
//
// 这三个组件是"列表 / 看板 / 抽屉三处一致"与"两种空态"的落点（见各自文件顶部）。
// 这组断言锁住它们的对外契约：
// - TaskMeta：四种属性的有无与**顺序**（截止 → 优先级 → 时长 → 标签）、逾期双通道
// - TaskItem：行解剖（状态圆点在行首、创建时间不再出现）、行内按钮**全部有可访问名**
// - TaskEmpty：筛空给"清除筛选"、真空不给按钮
//
// 风格与 file/components/FileCard.test.tsx 一致：solid-js/web render 手写 DOM。
// 查询一律走语义属性（aria-label / data-status / 文本），不依赖 CSS Modules 的
// 类名形态 —— vitest 桩掉 CSS 后类名与浏览器里不同（`dueBadge` vs `due-badge`）。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import type { Task } from "../api.ts";
import { TaskEmpty } from "./TaskEmpty.tsx";
import TaskItem from "./TaskItem.tsx";
import { TaskMeta } from "./TaskMeta.tsx";

const task = (over: Partial<Task> = {}): Task =>
	({
		id: 1,
		title: "写周报",
		description: null,
		parent_task_id: null,
		status: "backlog",
		completed_at: null,
		effort_estimate_minutes: null,
		start_at: null,
		due_at: null,
		priority: null,
		tags: [],
		created_at: "2026-09-01T00:00:00+00:00",
		updated_at: "2026-09-01T00:00:00+00:00",
		...over,
	}) as Task;

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

/** 按文本找元素（属性条没有语义标签，徽章都是 span） */
const byText = (host: HTMLElement, text: string) =>
	[...host.querySelectorAll<HTMLElement>("span, p, h3, dd")].find((el) =>
		el.textContent?.includes(text),
	);

// ── TaskMeta ──

describe("TaskMeta：属性条（列表/看板/抽屉共用）", () => {
	it("四种属性齐全时按 截止→优先级→时长→标签 的顺序渲染", () => {
		const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
		const host = mount(() => (
			<TaskMeta
				task={task({
					due_at: soon,
					priority: "p1",
					effort_estimate_minutes: 45,
					tags: [{ id: 7, name: "工作" }],
				})}
			/>
		));
		const order = (needle: string) => {
			const el = byText(host, needle);
			return [...host.children[0].children].indexOf(el as HTMLElement);
		};
		const iDue = order("还剩");
		const iPri = order("P1");
		const iEffort = order("45m");
		const iTag = order("#工作");
		expect(Math.min(iDue, iPri, iEffort, iTag)).toBeGreaterThanOrEqual(0);
		expect(iDue).toBeLessThan(iPri);
		expect(iPri).toBeLessThan(iEffort);
		expect(iEffort).toBeLessThan(iTag);
	});

	it("没有属性的任务一个徽章都不出（空串而不是几个空占位）", () => {
		const host = mount(() => <TaskMeta task={task()} />);
		expect(host.textContent?.trim()).toBe("");
	});

	it("逾期：文字（逾期 N 天）还在，且不是只换颜色（带逾期形态类）", () => {
		const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
		const host = mount(() => <TaskMeta task={task({ due_at: past })} />);
		const badge = byText(host, "逾期") as HTMLElement;
		expect(badge).toBeTruthy();
		// 类名在测试桩与真实构建里形态不同（dueOverdue / due-badge），按词匹配
		expect(badge.className).toMatch(/due-?overdue/i);
		expect(badge.textContent).toContain("逾期 3 天");
	});

	it("缺什么不渲染什么：有优先级没截止，就只有优先级", () => {
		const host = mount(() => <TaskMeta task={task({ priority: "p2" })} />);
		expect(host.textContent).toContain("P2");
		expect(byText(host, "还剩")).toBeUndefined();
		expect(byText(host, "#")).toBeUndefined();
	});
});

// ── TaskItem ──

function itemProps(over: Partial<Parameters<typeof TaskItem>[0]> = {}) {
	return {
		task: task(),
		onStatusChange: vi.fn(),
		onDelete: vi.fn(),
		onEdit: vi.fn(),
		children: [] as Task[],
		...over,
	};
}

describe("TaskItem：行解剖", () => {
	it("状态是行首的原生 select（data-status 跟着值走），在标题之前", () => {
		const host = mount(() => <TaskItem {...itemProps()} />);
		const select = host.querySelector(
			"select[data-status]",
		) as HTMLSelectElement;
		expect(select).not.toBeNull();
		expect(select.getAttribute("data-status")).toBe("backlog");
		const title = host.querySelector(
			"[class*='task-title'], [class*='taskTitle']",
		);
		// select 在文档序上先于标题（行首），且不嵌在标题里
		expect(title).not.toBeNull();
		expect(
			select.compareDocumentPosition(title as Node) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
	});

	it("改状态下拉会带着新值回调 onStatusChange", () => {
		const onStatusChange = vi.fn();
		const host = mount(() => <TaskItem {...itemProps({ onStatusChange })} />);
		const select = host.querySelector(
			"select[data-status]",
		) as HTMLSelectElement;
		select.value = "active";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(onStatusChange).toHaveBeenCalledWith(1, "active");
	});

	it("行内按钮全部有可访问名（回归：编辑/删除曾是空的，读屏念不出）", () => {
		const host = mount(() => (
			<TaskItem {...itemProps({ onUpdate: vi.fn() })} />
		));
		const unnamed = [...host.querySelectorAll("button")].filter(
			(b) =>
				!b.getAttribute("aria-label") &&
				!(b.textContent || "").trim() &&
				!b.getAttribute("title"),
		);
		expect(unnamed).toEqual([]);
		// 顺带钉住命名口径：带任务标题，读屏才知道动的是哪一条
		const add = [...host.querySelectorAll("button")].find((b) =>
			b.getAttribute("aria-label")?.startsWith("给「写周报」添加条件"),
		);
		expect(add).not.toBeUndefined();
		expect(add?.getAttribute("aria-label")).toBe("给「写周报」添加条件");
	});

	it("不渲染创建时间（它顶着日历图标会被读成截止，且不可操作）", () => {
		const host = mount(() => <TaskItem {...itemProps()} />);
		expect(host.textContent).not.toContain("2026/09/01");
		expect(host.textContent).not.toMatch(/创建/);
	});

	it("删除按钮回调 onDelete 并带上任务 id", () => {
		const onDelete = vi.fn();
		const host = mount(() => <TaskItem {...itemProps({ onDelete })} />);
		const del = [...host.querySelectorAll("button")].find((b) =>
			b.getAttribute("aria-label")?.startsWith("删除任务"),
		) as HTMLButtonElement;
		del.click();
		expect(onDelete).toHaveBeenCalledWith(1);
	});
});

// ── TaskEmpty ──

describe("TaskEmpty：两种空态", () => {
	it("有筛选或搜索：给清除按钮并回调 onClear", () => {
		const onClear = vi.fn();
		const host = mount(() => <TaskEmpty filtered onClear={onClear} />);
		expect(host.textContent).toContain("没有符合条件的任务");
		const btn = host.querySelector("button") as HTMLButtonElement;
		btn.click();
		expect(onClear).toHaveBeenCalledTimes(1);
	});

	it("什么都没设：说收件箱是空的，不给按钮", () => {
		const host = mount(() => <TaskEmpty filtered={false} onClear={vi.fn()} />);
		expect(host.textContent).toContain("还没有任务");
		expect(host.querySelector("button")).toBeNull();
	});
});
