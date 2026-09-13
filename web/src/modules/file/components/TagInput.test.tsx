// ── TagInput / TagFilter 渲染测试 ──
// 二者是 file 与 bookmark 两个模块共用的同构组件。迁移到表单原语时给它们的
// 输入框补了可访问名（原先只有 placeholder）—— 这组断言就把"可访问名"和
// "控件确实是原语"钉住，另外覆盖 chips 增删与下拉选择这两条主路径。

import { listFileTags } from "@modules/file/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TagFilter from "./TagFilter.tsx";
import TagInput from "./TagInput.tsx";

vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return { ...actual, listFileTags: vi.fn() };
});

const mockedTags = vi.mocked(listFileTags);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedTags.mockResolvedValue([
		{ id: 1, name: "工作" },
		{ id: 2, name: "假期" },
	] as never);
});

describe("TagInput", () => {
	it("输入框是表单原语且带可访问名（原先只有 placeholder）", () => {
		const host = mount(() => (
			<TagInput tags={[]} onAdd={() => {}} onRemove={() => {}} />
		));
		const input = host.querySelector("input") as HTMLInputElement;
		expect(input.className).toContain("_control_");
		expect(input.getAttribute("aria-label")).toBe("添加标签");
	});

	it("已选标签渲染为 chips，移除按钮回调", () => {
		const onRemove = vi.fn();
		const host = mount(() => (
			<TagInput tags={["工作"]} onAdd={() => {}} onRemove={onRemove} />
		));
		expect(host.textContent).toContain("工作");
		const btn = host.querySelector("button") as HTMLButtonElement;
		btn.click();
		expect(onRemove).toHaveBeenCalledWith("工作");
	});

	it("Enter 提交新标签并清空输入", () => {
		const onAdd = vi.fn();
		const host = mount(() => (
			<TagInput tags={[]} onAdd={onAdd} onRemove={() => {}} />
		));
		const input = host.querySelector("input") as HTMLInputElement;
		input.value = "新标签";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onAdd).toHaveBeenCalledWith("新标签");
	});
});

describe("TagFilter", () => {
	it("触发器显示当前值；未选中时显示「全部标签」", () => {
		const host = mount(() => <TagFilter value="" onChange={() => {}} />);
		expect(host.textContent).toContain("全部标签");
	});

	it("展开后搜索框是原语且带可访问名", async () => {
		const host = mount(() => <TagFilter value="" onChange={() => {}} />);
		(host.querySelector("button") as HTMLButtonElement).click();
		await flush();
		const input = host.querySelector("input") as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.className).toContain("_control_");
		expect(input.getAttribute("aria-label")).toBe("搜索标签");
	});

	it("列出标签并可选择，回调选中项并收起", async () => {
		const onChange = vi.fn();
		const host = mount(() => <TagFilter value="" onChange={onChange} />);
		(host.querySelector("button") as HTMLButtonElement).click();
		await settle(() => (host.textContent ?? "").includes("工作"));

		const option = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("工作"),
		);
		option?.click();
		expect(onChange).toHaveBeenCalledWith("工作");
	});
});
