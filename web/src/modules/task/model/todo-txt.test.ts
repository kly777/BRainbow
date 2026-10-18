import { describe, expect, it } from "vite-plus/test";
import { formatTodoTask, parseTodoCommand, parseTodoText } from "./todo-txt.ts";

describe("parseTodoText", () => {
	it("解析 (A)、+/@ 标签与 due 日期", () => {
		const parsed = parseTodoText("(A) 写周报 +工作 @电话 due:2026-10-20");
		expect(parsed.title).toBe("写周报");
		expect(parsed.priority).toBe("p1");
		expect(parsed.tags).toEqual(["工作", "电话"]);
		expect(parsed.dueAt).toBe(
			new Date(2026, 9, 20, 23, 59, 0, 0).toISOString(),
		);
	});

	it("兼容录入框的 !p1 优先级", () => {
		const parsed = parseTodoText("买菜 !p3");
		expect(parsed.title).toBe("买菜");
		expect(parsed.priority).toBe("p3");
	});

	it("没有优先级和日期时保持原文", () => {
		const parsed = parseTodoText("  给妈妈打电话  ");
		expect(parsed.title).toBe("给妈妈打电话");
		expect(parsed.priority).toBeNull();
		expect(parsed.tags).toEqual([]);
		expect(parsed.dueAt).toBeNull();
	});
});

describe("parseTodoCommand", () => {
	it("add / list / do / undo", () => {
		expect(parseTodoCommand("add (B) 修灯泡 +家务")).toMatchObject({
			kind: "add",
			title: "修灯泡",
			priority: "p2",
			tags: ["家务"],
		});
		expect(parseTodoCommand("list 周报")).toEqual({
			kind: "list",
			query: "周报",
		});
		expect(parseTodoCommand("do #12")).toEqual({ kind: "do", ids: [12] });
		expect(parseTodoCommand("undo 12")).toEqual({ kind: "undo", ids: [12] });
		expect(parseTodoCommand("do 12, 15 20")).toEqual({
			kind: "do",
			ids: [12, 15, 20],
		});
	});

	it("addm / append / prepend / replace", () => {
		expect(parseTodoCommand("addm 买菜 | (A) 写周报 +工作")).toMatchObject({
			kind: "add-many",
			items: [
				{ title: "买菜" },
				{ title: "写周报", priority: "p1", tags: ["工作"] },
			],
		});
		expect(parseTodoCommand("append 7 补充一句")).toEqual({
			kind: "edit",
			id: 7,
			mode: "append",
			text: "补充一句",
		});
		expect(parseTodoCommand("prepend 7 先做")).toEqual({
			kind: "edit",
			id: 7,
			mode: "prepend",
			text: "先做",
		});
		expect(parseTodoCommand("replace 7 新标题")).toEqual({
			kind: "edit",
			id: 7,
			mode: "replace",
			text: "新标题",
		});
	});

	it("pri 支持两种参数顺序，depri 清空", () => {
		expect(parseTodoCommand("pri 12 A")).toEqual({
			kind: "pri",
			id: 12,
			priority: "p1",
		});
		expect(parseTodoCommand("pri B 12")).toEqual({
			kind: "pri",
			id: 12,
			priority: "p2",
		});
		expect(parseTodoCommand("depri 12")).toEqual({
			kind: "depri",
			ids: [12],
		});
		expect(parseTodoCommand("depri 12 15")).toEqual({
			kind: "depri",
			ids: [12, 15],
		});
	});

	it("due 接受合法日期与 none", () => {
		const due = parseTodoCommand("due 12 2026-10-20");
		expect(due.kind).toBe("due");
		if (due.kind === "due") {
			expect(due.dueAt).toBe(new Date(2026, 9, 20, 23, 59, 0, 0).toISOString());
		}
		expect(parseTodoCommand("due 12 none")).toEqual({
			kind: "due",
			id: 12,
			dueAt: null,
		});
		expect(parseTodoCommand("due 12 2026-02-30")).toMatchObject({
			kind: "error",
		});
	});

	it("tag / untag / archive / help", () => {
		expect(parseTodoCommand("tag 12 +工作")).toEqual({
			kind: "tag",
			id: 12,
			tag: "工作",
			remove: false,
		});
		expect(parseTodoCommand("untag 12 @电话")).toEqual({
			kind: "tag",
			id: 12,
			tag: "电话",
			remove: true,
		});
		expect(parseTodoCommand("archive")).toEqual({
			kind: "archive",
			id: null,
		});
		expect(parseTodoCommand("archive 3")).toEqual({
			kind: "archive",
			id: 3,
		});
		expect(parseTodoCommand("help")).toEqual({ kind: "help", command: "" });
		expect(parseTodoCommand("help add")).toEqual({
			kind: "help",
			command: "add",
		});
	});

	it("del 支持多 id 和只移除某个词", () => {
		expect(parseTodoCommand("del 3 5")).toEqual({
			kind: "delete",
			ids: [3, 5],
		});
		expect(parseTodoCommand("del 3 旧标题")).toEqual({
			kind: "delete",
			ids: [3],
			term: "旧标题",
		});
	});

	it("listall / listpri / listproj / listcon", () => {
		expect(parseTodoCommand("listall 周报")).toEqual({
			kind: "list-all",
			query: "周报",
		});
		expect(parseTodoCommand("listpri A 周报")).toEqual({
			kind: "list-pri",
			priority: "p1",
			query: "周报",
		});
		expect(parseTodoCommand("listpri")).toEqual({
			kind: "list-pri",
			priority: null,
			query: "",
		});
		expect(parseTodoCommand("listproj +工作")).toEqual({
			kind: "list-tag",
			tag: "工作",
		});
		expect(parseTodoCommand("listcon @电话")).toEqual({
			kind: "list-tag",
			tag: "电话",
		});
	});

	it("未知命令与缺参数给明确错误", () => {
		expect(parseTodoCommand("frobnicate")).toMatchObject({
			kind: "error",
		});
		expect(parseTodoCommand("do")).toMatchObject({ kind: "error" });
		expect(parseTodoCommand("add")).toMatchObject({ kind: "error" });
	});
});

describe("formatTodoTask", () => {
	it("输出 #id、优先级、标签与完成前缀", () => {
		const line = formatTodoTask({
			id: 7,
			title: "写周报",
			status: "completed",
			priority: "p1",
			tags: [{ name: "工作" }],
			due_at: null,
		});
		expect(line).toContain("x #7 (A) 写周报 +工作");
	});
});
