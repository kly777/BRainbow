// ── /task：任务工作台的页面级冒烟 ──
// 只验证页面骨架、录入区与任务行都在；接口全部在浏览器层造，不依赖后端。
import { expect, test } from "@playwright/test";
import { mockApi, page1 } from "../fixtures/api.ts";

const task = {
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
};

test("任务工作台能渲染任务行与录入区", async ({ page }) => {
	await mockApi(page, [
		{ path: "/api/tasks", body: page1([task], 1) },
		{
			path: "/api/tasks/stats",
			body: { backlog: 1, active: 0, completed: 0, archived: 0 },
		},
		{ path: "/api/tasks/calendar", body: [] },
		{ path: "/api/calendar/events", body: [] },
		{ path: "/api/tags", body: [] },
	]);

	await page.goto("/task");

	await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
	await expect(page.getByText("记一件事")).toBeVisible();
	await expect(page.getByText("写周报")).toBeVisible();
});
