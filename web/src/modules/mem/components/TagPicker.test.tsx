// ── TagPicker 渲染测试 ──
// 本组件在表单原语迁移中换过输入框。断言聚焦迁移后的契约：
// 输入框是原语且带可访问名、chips 增删、搜索走后端接口、创建标签路径。

import { searchTagsE } from "@modules/mem/api-tags.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TagPicker from "./TagPicker.tsx";

// mock 叶子模块：TagPicker 经 barrel 取到的是同一条绑定，但 mock barrel 时
// vitest 的 importOriginal 展开不会替换已被解构的引用（项目里已踩过两次）
vi.mock("@modules/mem/api-tags.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@modules/mem/api-tags.ts")>();
	return { ...actual, searchTagsE: vi.fn(), createTagE: vi.fn() };
});

const mockedSearch = vi.mocked(searchTagsE);

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedSearch.mockResolvedValue([{ id: 9, name: "量子" }] as never);
});

describe("TagPicker", () => {
	it("输入框是表单原语且带可访问名", () => {
		const host = mount(() => (
			<TagPicker selected={[]} onAdd={() => {}} onRemove={() => {}} />
		));
		const input = host.querySelector("input") as HTMLInputElement;
		expect(input.className).toContain("_control_");
		expect(input.getAttribute("aria-label")).toBe("搜索或添加标签");
	});

	it("已选标签渲染为 chips 并可移除", () => {
		const onRemove = vi.fn();
		const host = mount(() => (
			<TagPicker
				selected={[{ id: 1, name: "工作" }] as never}
				onAdd={() => {}}
				onRemove={onRemove}
			/>
		));
		expect(host.textContent).toContain("工作");
		// chip 的移除按钮带 aria-label（图标按钮，无可见文案）
		const btn = host.querySelector(
			"button[aria-label='移除标签 工作']",
		) as HTMLButtonElement;
		btn.click();
		expect(onRemove).toHaveBeenCalledWith(1);
	});

	it("输入时查询后端并展示建议", async () => {
		const host = mount(() => (
			<TagPicker selected={[]} onAdd={() => {}} onRemove={() => {}} />
		));
		const input = host.querySelector("input") as HTMLInputElement;
		input.value = "量";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		for (let i = 0; i < 50 && !(host.textContent ?? "").includes("量子"); i++) {
			await flush();
		}
		expect(mockedSearch).toHaveBeenCalledWith("量");
		expect(host.textContent).toContain("量子");
	});

	it("点击建议项回调 onAdd", async () => {
		const onAdd = vi.fn();
		const host = mount(() => (
			<TagPicker selected={[]} onAdd={onAdd} onRemove={() => {}} />
		));
		const input = host.querySelector("input") as HTMLInputElement;
		input.value = "量";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		for (let i = 0; i < 50 && !(host.textContent ?? "").includes("量子"); i++) {
			await flush();
		}
		// 建议项用 onMouseDown 提交（避免 blur 先收起下拉），故派发 mousedown
		const option = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("量子"),
		) as HTMLButtonElement;
		option.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
		expect(onAdd).toHaveBeenCalledWith({ id: 9, name: "量子" });
	});
});
