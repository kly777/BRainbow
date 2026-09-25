// ── CardsList 渲染回归测试 ──
// 本页的数据源刚从"手写信号 + 手搓 fetch"迁到 useListResource，且页面里
// 重复的那份 loadInitial 被删掉了 —— 取数改为由 createResource 在挂载时发起。
// 这组断言就是封堵"迁移后列表不显示 / 四态失效"这类回归。

import {
	createCardE,
	deleteCardE,
	getCardsE,
	searchCardsE,
} from "@modules/card";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CardsListPage from "./CardsList.tsx";

vi.mock("@modules/card/api.ts", () => ({
	createCardE: vi.fn(),
	deleteCardE: vi.fn(),
	getCardsE: vi.fn(),
	searchCardsE: vi.fn(),
}));

let urlQ = "";
vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useSearchParams: () => [
		{
			get q() {
				return urlQ;
			},
		},
		vi.fn(),
	],
}));

const confirmResolve = vi.fn();
vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return { ...actual, showConfirm: () => confirmResolve() };
});

const mockedGet = vi.mocked(getCardsE);
const mockedSearch = vi.mocked(searchCardsE);
const mockedCreate = vi.mocked(createCardE);
const mockedDelete = vi.mocked(deleteCardE);

const card = (id: number, content = `卡片${id}`) => ({
	id,
	content,
	created_at: "2026-08-22T00:00:00+00:00",
	updated_at: "2026-08-22T00:00:00+00:00",
});
const paginated = (
	items: ReturnType<typeof card>[],
	page: number,
	totalPages: number,
) => ({
	items,
	page,
	total_pages: totalPages,
	total: items.length,
	page_size: 20,
});

const flush = () => new Promise((r) => setTimeout(r, 0));
/** 轮询等待条件成立：资源值提交在微任务之后 */
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

/** 卡片数量：正文走 Markdown 懒加载壳，异步 chunk 未必在断言前就绪，
    故用每张卡片都会渲染的元信息行（"创建于："）计数 */
const cardCount = (host: HTMLElement) =>
	(host.textContent?.match(/创建于：/g) ?? []).length;

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <CardsListPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	urlQ = "";
	confirmResolve.mockResolvedValue(true);
	mockedGet.mockResolvedValue(paginated([card(1), card(2)], 1, 1));
});

describe("CardsList：数据接入", () => {
	it("挂载后渲染接口返回的卡片（取数交给数据源，页面不再自己拉）", async () => {
		const host = mount();
		await settle(() => cardCount(host) === 2);
		expect(cardCount(host)).toBe(2);
	});

	it("页面有唯一 h1", async () => {
		const host = mount();
		await flush();
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("卡片列表");
	});

	it("空列表显示空态文案（非搜索态）", async () => {
		mockedGet.mockResolvedValue(paginated([], 1, 0));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("还没有卡片"));
		expect(host.textContent).toContain("还没有卡片");
	});

	it("加载失败显示错误态与重试入口", async () => {
		mockedGet.mockRejectedValue(new Error("网络断了"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("网络断了"));
		expect(host.innerHTML).toContain("网络断了");
		expect(host.querySelector("button")).toBeTruthy();
	});

	it("URL 带 q 时进入搜索态并走 searchCardsE", async () => {
		urlQ = "量子";
		mockedSearch.mockResolvedValue(paginated([card(9, "量子卡片")], 1, 1));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("量子卡片"));
		expect(mockedSearch).toHaveBeenCalledWith("量子", 1);
	});
});

describe("CardsList：写操作", () => {
	it("列表条数跟随接口数据（单条时只渲染一张）", async () => {
		mockedGet.mockResolvedValue(paginated([card(7)], 1, 1));
		const host = mount();
		await settle(() => cardCount(host) === 1);
		expect(cardCount(host)).toBe(1);
		expect(mockedDelete).not.toHaveBeenCalled();
	});

	it("创建成功后新卡片出现在列表里", async () => {
		mockedCreate.mockResolvedValue(card(99, "新卡片"));
		const host = mount();
		await settle(() => cardCount(host) === 2);

		// 打开弹窗 → 输入 → 点创建
		const openBtn = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("快速创建"),
		);
		openBtn?.click();
		await flush();

		const textarea = document.querySelector("textarea");
		expect(textarea).toBeTruthy();
		if (textarea) {
			textarea.value = "新卡片";
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		}
		await flush();

		const createBtn = Array.from(document.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "创建",
		);
		createBtn?.click();
		await settle(() => (document.body.textContent ?? "").includes("新卡片"));
		expect(mockedCreate).toHaveBeenCalledWith({ content: "新卡片" });
	});
});
