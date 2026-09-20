// ── CardEdit 渲染测试 ──
// 本页刚把"用列表原语 AsyncView 包单实体"换成 AsyncSection，并新增 .body 作为
// AsyncSection 的内容容器（页面是 flex 列布局，工作台靠 flex:1 撑满 —— 少一层
// 撑高就塌）。断言锁住三件事：加载时不出现工作台、加载完工作台在 .body 里、
// 无效 id 走到错误态而不是卡骨架（AsyncSection 的 error → loading 顺序）。

import { getCardE } from "@modules/card";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CardEditPage from "./CardEdit.tsx";

vi.mock("@modules/card", () => ({
	getCardE: vi.fn(),
	deleteCardE: vi.fn(),
	updateCardE: vi.fn(),
}));

let routeId: string | undefined = "42";
vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({
		get id() {
			return routeId;
		},
	}),
}));

const mockedGet = vi.mocked(getCardE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <CardEditPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	routeId = "42";
	mockedGet.mockResolvedValue({
		id: 42,
		content: "# 标题\n正文",
		created_at: "2026-09-01T10:00:00+00:00",
		updated_at: "2026-09-02T10:00:00+00:00",
	} as never);
});

describe("CardEdit", () => {
	it("取数未回来时只出骨架，不出工作台", () => {
		mockedGet.mockReturnValue(new Promise(() => {}) as never);
		const host = mount();
		expect(host.textContent).not.toContain("实时预览");
		expect(host.querySelector('[role="status"]')).toBeTruthy();
	});

	it("取数回来后工作台挂在 .body 容器里（flex 撑高链）", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("实时预览"));

		expect(host.textContent).toContain("编辑卡片");
		expect(host.textContent).toContain("实时预览");
		// 状态栏字数
		expect(host.textContent).toContain("字");

		// 结构契约：工作台（.workspace）的父元素是 AsyncSection 的内容容器 .body
		const pane = Array.from(host.querySelectorAll("section")).find((s) =>
			s.className.includes("_pane_"),
		);
		expect(pane).toBeTruthy();
		// .pane → .panes → .workspace → .body
		const workspace = pane?.parentElement?.parentElement as HTMLElement;
		expect(workspace.className).toContain("_workspace_");
		expect(workspace.parentElement?.className).toContain("_body_");
	});

	it("无效 id 走到错误态（不卡骨架屏）", async () => {
		routeId = "abc";
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("无效"));

		expect(host.textContent).toContain("无效ID");
		expect(host.querySelector('[role="status"]')).toBeNull();
		expect(mockedGet).not.toHaveBeenCalled();
	});
});
