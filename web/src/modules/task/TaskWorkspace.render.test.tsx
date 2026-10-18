// @vitest-environment jsdom
// ── /task 页面组合测试：布局、范围切换、列表行都在正确位置 ──

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("@solidjs/router", () => ({
	A: (props: { href: string; children: unknown; class?: string }) => (
		<a href={props.href} class={props.class}>
			{props.children as never}
		</a>
	),
	useNavigate: () => vi.fn(),
}));

vi.mock("./view/useTaskWorkspace.ts", () => {
	const tasks = [
		{
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
			created_at: "2026-10-01T08:00:00+00:00",
			updated_at: "2026-10-01T08:00:00+00:00",
		},
	];
	return {
		useTaskWorkspaceView: () => ({
			tasks: () => tasks,
			loading: () => false,
			updateStatus: vi.fn(),
			removeTask: vi.fn(),
			filter: () => ({}),
			setFilter: vi.fn(),
			sort: () => "smart",
			setSort: vi.fn(),
			scope: () => "all",
			view: () => "stream",
			searchQuery: () => "",
			filterOpen: () => false,
			setFilterOpen: vi.fn(),
			counts: () => ({
				all: 1,
				today: 0,
				upcoming: 0,
				overdue: 0,
				completed: 0,
			}),
			scoped: () => tasks,
			chooseScope: vi.fn(),
			chooseView: vi.fn(),
			setSearch: vi.fn(),
			openTask: vi.fn(),
			submit: vi.fn(),
			searchTags: vi.fn(),
			pageTitle: () => "任务",
			calendar: {},
			hasFilter: () => false,
			scopes: [{ key: "all", label: "全部" }],
			emptyFilter: {},
		}),
	};
});

vi.mock("./components/CaptureInput.tsx", () => ({
	default: () => <div data-testid="capture" />,
}));
vi.mock("./components/TaskFilterPanel.tsx", () => ({
	default: () => <div data-testid="filter-panel" />,
	ActiveFilterChips: () => null,
}));
vi.mock("./components/TaskCalendar.tsx", () => ({
	default: () => <div data-testid="calendar" />,
}));
vi.mock("./components/ThreeDayTimeline.tsx", () => ({
	default: () => <div data-testid="timeline" />,
}));
vi.mock("./workspace/TaskBoard.tsx", () => ({
	default: () => <div data-testid="board" />,
}));
vi.mock("./components/TaskDag.tsx", () => ({
	default: () => <div data-testid="dag" />,
}));
vi.mock("./workspace/TaskCommandBar.tsx", () => ({
	default: () => <div data-testid="command-bar" />,
}));

const { default: TaskWorkspace } = await import("./TaskWorkspace.tsx");

const mount = () => {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <TaskWorkspace />, host);
	return host;
};

describe("/task 页面组合", () => {
	it("页面头部、搜索、范围切换、任务行和命令栏都在", () => {
		const host = mount();
		expect(host.textContent).toContain("任务");
		expect(host.querySelector('[aria-label="时间范围"]')).not.toBeNull();
		expect(host.textContent).toContain("写周报");
		expect(host.querySelector('[data-testid="command-bar"]')).not.toBeNull();
		expect(host.querySelector('[data-testid="calendar"]')).not.toBeNull();
	});

	it("任务类型由 view model 决定的内容渲染为标题", () => {
		const host = mount();
		expect(host.textContent).toContain("全部");
	});
});
