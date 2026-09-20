// ── ChatSidebar 渲染测试 ──
// 侧边栏的空态刚从模块自己的 <div class={treeEmpty}> 换成共享 EmptyState，
// 断言锁住：树为空且不在加载时给 emptyText，有树时列标题、给加载骨架。

import type { ChatTree } from "@modules/chat";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatSidebar } from "./ChatSidebar.tsx";

// 列表项的重命名 / AI 取名按钮会调接口，这里只渲染不点击，mock 掉避免真请求
vi.mock("../api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../api.ts")>();
	return { ...actual, updateTreeE: vi.fn() };
});

function tree(over: Partial<ChatTree> = {}): ChatTree {
	return { id: 1, title: "第一次对话", kind: "chat", ...over } as ChatTree;
}

function mount(trees: ChatTree[], loading = false) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<ChatSidebar
				trees={() => trees}
				loadingTrees={() => loading}
				currentTreeId={() => null}
				collapsed={false}
				title="对话"
				newLabel="新建"
				emptyText="还没有对话"
				onCreate={() => {}}
				onSelect={() => {}}
				onRename={() => {}}
				onAiTitle={() => {}}
				onDelete={() => {}}
			/>
		),
		host,
	);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = "";
});

describe("ChatSidebar", () => {
	it("没有会话时给出空态文案", () => {
		const host = mount([]);
		expect(host.textContent).toContain("还没有对话");
	});

	it("有会话时列出标题，不出空态", () => {
		const host = mount([tree(), tree({ id: 2, title: "第二次对话" })]);
		expect(host.textContent).toContain("第一次对话");
		expect(host.textContent).toContain("第二次对话");
		expect(host.textContent).not.toContain("还没有对话");
	});

	it("加载中出骨架而不是空态（否则会先闪一下「没有会话」）", () => {
		const host = mount([], true);
		expect(host.textContent).not.toContain("还没有对话");
		expect(host.querySelector('[aria-hidden="true"]')).toBeTruthy();
	});
});
