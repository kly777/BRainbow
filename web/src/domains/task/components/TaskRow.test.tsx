// @vitest-environment jsdom
// ── TaskRow 渲染契约：标题去哪里、状态怎么改、删除按钮叫什么 ──

import { render } from "solid-js/web";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vite-plus/test";
import type { Task } from "../api.ts";
import TaskRow from "./TaskRow.tsx";

vi.mock("@solidjs/router", () => ({
	A: (props: {
		href: string;
		class?: string;
		children: unknown;
		onClick?: (event: MouseEvent) => void;
	}) => (
		<a href={props.href} class={props.class} onClick={props.onClick}>
			{props.children as never}
		</a>
	),
	useNavigate: () => vi.fn(),
}));

const task = (over: Partial<Task> = {}): Task => ({
	id: 7,
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
	created_at: "2026-10-01T08:00:00+00:00",
	updated_at: "2026-10-01T08:00:00+00:00",
	...over,
});

const mount = (props: Parameters<typeof TaskRow>[0]) => {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <TaskRow {...props} />, host);
	return host;
};

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date("2026-10-18T10:00:00+08:00"));
});

afterEach(() => {
	vi.useRealTimers();
});

describe("TaskRow", () => {
	it("标题链到详情页，行首状态可改", () => {
		const onStatusChange = vi.fn();
		const host = mount({
			task: task(),
			onStatusChange,
			onDelete: vi.fn(),
		});

		expect(host.querySelector("a")?.getAttribute("href")).toBe("/task/7");
		expect(host.textContent).toContain("写周报");

		const select = host.querySelector("select") as HTMLSelectElement;
		select.value = "completed";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(onStatusChange).toHaveBeenCalledWith(7, "completed");
	});

	it("给了 onSelect 时，点标题在右栏打开而不是跳页", () => {
		const onSelect = vi.fn();
		const host = mount({
			task: task(),
			onSelect,
			onStatusChange: vi.fn(),
			onDelete: vi.fn(),
		});
		(host.querySelector("a") as HTMLAnchorElement).click();
		expect(onSelect).toHaveBeenCalledWith(7);
	});

	it("属性条显示截止与标签，删除按钮有可访问名", () => {
		const onDelete = vi.fn();
		const host = mount({
			task: task({
				due_at: "2026-12-01T09:00:00+00:00",
				tags: [{ id: 1, name: "工作" }],
			}),
			onStatusChange: vi.fn(),
			onDelete,
		});

		expect(host.textContent).toContain("#工作");
		expect(host.textContent).toContain("12-01");

		const del = host.querySelector(
			'button[aria-label="删除任务：写周报"]',
		) as HTMLButtonElement;
		expect(del).not.toBeNull();
		del.click();
		expect(onDelete).toHaveBeenCalledWith(7);
	});

	it("子任务与父任务并列时显示父任务链接", () => {
		const host = mount({
			task: task({ parent_task_id: 1 }),
			parentTask: task({ id: 1, title: "父任务" }),
			onStatusChange: vi.fn(),
			onDelete: vi.fn(),
		});
		expect(host.textContent).toContain("子任务");
		expect(host.textContent).toContain("父任务：父任务");
		expect(host.querySelector('a[href="/task/1"]')).not.toBeNull();
	});
});
