// ── BasicInfoTab 渲染测试 ──
// 本组件是表单原语迁移的一处落点：原先的裸 <input>/<select>/<textarea> 换成了
// Input/Select/Textarea。这组断言锁住迁移后的契约：
//  1. 控件确实带上了原语的基础类（Control 模块）；
//  2. label 的 for 与控件的 id 仍一一对应（迁移不该破坏既有关联）；
//  3. 输入仍回调到对应的 setter。

import type { ComponentProps } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import BasicInfoTab from "./BasicInfoTab.tsx";

type TabProps = ComponentProps<typeof BasicInfoTab>;

function props(over: Partial<TabProps> = {}): TabProps {
	return {
		title: () => "原标题",
		setTitle: vi.fn(),
		description: () => "原描述",
		setDescription: vi.fn(),
		status: () => "backlog",
		setStatus: vi.fn(),
		effort: () => undefined,
		setEffort: vi.fn(),
		parentTaskId: () => undefined,
		setParentTaskId: vi.fn(),
		allTasks: [],
		currentTaskId: 1,
		...over,
	};
}

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("BasicInfoTab：表单原语迁移后的回归", () => {
	it("控件带上了 Control 原语的基础类", () => {
		const host = mount(() => <BasicInfoTab {...props()} />);
		const input = host.querySelector("#task-title") as HTMLInputElement;
		const textarea = host.querySelector("#task-desc") as HTMLTextAreaElement;
		expect(input?.className).toContain("_control_");
		expect(textarea?.className).toContain("_control_");
	});

	it("每个可见控件的 label 都指向存在的控件（关联未被迁移破坏）", () => {
		const host = mount(() => <BasicInfoTab {...props()} />);
		const labels = Array.from(host.querySelectorAll("label[for]"));
		expect(labels.length).toBeGreaterThan(0);
		for (const l of labels) {
			const target = host.querySelector(`#${l.getAttribute("for")}`);
			expect(
				target,
				`label for=${l.getAttribute("for")} 未找到对应控件`,
			).toBeTruthy();
		}
	});

	it("标题输入回调 setTitle", () => {
		const setTitle = vi.fn();
		const host = mount(() => <BasicInfoTab {...props({ setTitle })} />);
		const input = host.querySelector("#task-title") as HTMLInputElement;
		expect(input.value).toBe("原标题");
		input.value = "新标题";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(setTitle).toHaveBeenCalledWith("新标题");
	});

	it("状态下拉是原生 select（保留键盘与移动端行为）且回调", () => {
		const setStatus = vi.fn();
		const host = mount(() => <BasicInfoTab {...props({ setStatus })} />);
		const select = host.querySelector("#task-status") as HTMLSelectElement;
		expect(select?.tagName).toBe("SELECT");
		select.value = "active";
		select.dispatchEvent(new Event("change", { bubbles: true }));
		expect(setStatus).toHaveBeenCalledWith("active");
	});
});
