// ── 共享 TagInput 渲染测试 ──
// 覆盖两种候选来源（本地全量 / 远程搜索）、Enter 落点、候选行内删除后的重取。
// file 与 bookmark 只是它的两个数据适配器（各自的测试在模块里）。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import TagInput, { type TagOption } from "./TagInput.tsx";

const OPTIONS: TagOption[] = [
	{ id: 1, name: "工作" },
	{ id: 2, name: "工作日" },
	{ id: 3, name: "假期", count: 4 },
];

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

const inputOf = (host: HTMLElement) =>
	host.querySelector("input") as HTMLInputElement;

function type(host: HTMLElement, value: string) {
	const input = inputOf(host);
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pressEnter(host: HTMLElement) {
	inputOf(host).dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);
}

describe("TagInput（本地全量模式）", () => {
	it("候选来自 allOptions，按输入本地筛选", () => {
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={() => {}}
				onRemove={() => {}}
				allOptions={() => OPTIONS}
			/>
		));
		type(host, "工");
		expect(host.textContent).toContain("工作");
		expect(host.textContent).toContain("工作日");
		expect(host.textContent).not.toContain("假期");
	});

	it("已选项不出现在候选里", () => {
		const host = mount(() => (
			<TagInput
				selected={["工作"]}
				onAdd={() => {}}
				onRemove={() => {}}
				allOptions={() => OPTIONS}
			/>
		));
		type(host, "工作");
		const dropdown = host.querySelectorAll("button");
		// chips 的移除按钮 + "工作日" + "使用/创建"；不应有选中 "工作" 的候选行
		expect(host.textContent).toContain("工作日");
		expect(
			Array.from(dropdown).filter((b) => b.textContent?.trim() === "工作"),
		).toHaveLength(0);
	});

	it("Enter 提交新标签（无候选时用输入原文）并清空输入", () => {
		const onAdd = vi.fn();
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={onAdd}
				onRemove={() => {}}
				allOptions={() => OPTIONS}
			/>
		));
		type(host, "全新标签");
		pressEnter(host);
		expect(onAdd).toHaveBeenCalledWith("全新标签");
		expect(inputOf(host).value).toBe("");
	});

	it("Enter 取候选（有候选时不用原文）", () => {
		const onAdd = vi.fn();
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={onAdd}
				onRemove={() => {}}
				allOptions={() => OPTIONS}
			/>
		));
		type(host, "工");
		pressEnter(host);
		expect(onAdd).toHaveBeenCalledWith("工作");
	});

	it("输入框带默认可访问名", () => {
		const host = mount(() => (
			<TagInput selected={[]} onAdd={() => {}} onRemove={() => {}} />
		));
		expect(inputOf(host).getAttribute("aria-label")).toBe("添加标签");
	});
});

describe("TagInput（远程搜索模式）", () => {
	it("按 query 请求，且空 query 不发请求", async () => {
		const search = vi.fn(async () => [OPTIONS[0]]);
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={() => {}}
				onRemove={() => {}}
				search={search}
			/>
		));
		expect(search).not.toHaveBeenCalled();
		type(host, "量");
		await settle(() => search.mock.calls.length > 0);
		expect(search).toHaveBeenCalledWith("量");
	});

	it("候选行带计数与删除入口，删除返回 true 后重取候选", async () => {
		const search = vi.fn(async () => [{ id: 3, name: "假期", count: 4 }]);
		const onDeleteOption = vi.fn(async () => true);
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={() => {}}
				onRemove={() => {}}
				search={search}
				showCount
				onDeleteOption={onDeleteOption}
			/>
		));
		type(host, "假");
		await settle(() => (host.textContent ?? "").includes("假期"));
		expect(host.textContent).toContain("4");

		const del = host.querySelector(
			"button[title='删除标签「假期」']",
		) as HTMLButtonElement;
		del.click();
		await settle(() => search.mock.calls.length >= 2);
		expect(onDeleteOption).toHaveBeenCalledWith({
			id: 3,
			name: "假期",
			count: 4,
		});
		expect(search.mock.calls.length).toBeGreaterThanOrEqual(2);
	});

	it("删除被取消（返回 false）时不重取", async () => {
		const search = vi.fn(async () => [{ id: 3, name: "假期", count: 4 }]);
		const onDeleteOption = vi.fn(async () => false);
		const host = mount(() => (
			<TagInput
				selected={[]}
				onAdd={() => {}}
				onRemove={() => {}}
				search={search}
				showCount
				onDeleteOption={onDeleteOption}
			/>
		));
		type(host, "假");
		await settle(() => (host.textContent ?? "").includes("假期"));
		const callsAfterSearch = search.mock.calls.length;

		(
			host.querySelector(
				"button[title='删除标签「假期」']",
			) as HTMLButtonElement
		).click();
		await flush();
		await flush();
		expect(onDeleteOption).toHaveBeenCalled();
		expect(search.mock.calls.length).toBe(callsAfterSearch);
	});
});
