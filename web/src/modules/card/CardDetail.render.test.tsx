// ── CardDetail 无效 id 的失败态回归 ──
// 背景（doc/frontend-ui-architecture.md P1-5）：createResource 的 fetcher 里
// `throw` 会中断 Solid 的响应式更新，而本页用 AsyncView —— 它先判 loading，
// 于是错误态与重试入口都到不了，页面**永远显示骨架屏**。
// 此处的断言就是封堵这一点：无效 id 必须走到错误态。

import { getCardE } from "@modules/card";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CardDetailPage from "./CardDetail.tsx";

vi.mock("@modules/card", () => ({
	getCardE: vi.fn(),
	deleteCardE: vi.fn(),
}));

// 路由参数：本组用非数字 id 触发校验分支
let routeId: string | undefined = "abc";
vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({
		get id() {
			return routeId;
		},
	}),
	useLocation: () => ({ pathname: "/card/abc", state: null }),
}));

const mockedGet = vi.mocked(getCardE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

beforeEach(() => {
	vi.clearAllMocks();
	routeId = "abc";
	document.body.innerHTML = "";
});

function mount() {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <CardDetailPage />, host);
	return host;
}

describe("CardDetail：无效 id", () => {
	it("显示错误态而不是卡在骨架屏", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("无效"));

		expect(host.textContent).toContain("无效ID");
		// 骨架屏必须已让位 —— 修复前它才是唯一可见的东西
		expect(host.querySelector('[class*="skeletonWrap"]')).toBeNull();
		// 不应发起请求
		expect(mockedGet).not.toHaveBeenCalled();
	});

	it("合法 id 仍正常取数（校验没有误伤正常路径）", async () => {
		routeId = "42";
		mockedGet.mockResolvedValue({
			id: 42,
			content: "正常卡片",
			created_at: "2026-08-22T00:00:00+00:00",
			updated_at: "2026-08-22T00:00:00+00:00",
		} as never);

		const host = mount();
		await settle(() => mockedGet.mock.calls.length > 0);

		expect(mockedGet).toHaveBeenCalledWith(42);
		// 不应出现错误态
		await settle(() => true);
		expect(host.textContent).not.toContain("无效ID");
	});
});
