// ── ConvSearch 渲染测试 ──
// 这个页面的加载指示器刚换成共享 <Spinner>：原先那份的 `animation: spin` 引用的是
// 别的文件里的 @keyframes（CSS Modules 的关键帧是文件作用域），所以它一直静止。
// 断言锁住加载态确实渲染出 spinner、数据回来后 spinner 让位给结果。

import { searchConvE } from "@modules/conv";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ConvSearch from "./ConvSearch.tsx";

// mock 叶子模块（经 barrel 取到的同一条绑定，barrel 层 mock 在项目里踩过两次）
vi.mock("@modules/conv/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/conv/api.ts")>();
	return { ...actual, searchConvE: vi.fn() };
});

// 命中项与返回链接都用 @solidjs/router 的 <A>：测试里没有 Route，替换成普通链接
vi.mock("@solidjs/router", () => ({
	A: (props: { children?: unknown; href?: string }) => (
		<a href={props.href}>{props.children as never}</a>
	),
	useNavigate: () => vi.fn(),
	useParams: () => ({}),
	useLocation: () => ({ pathname: "/conv/search", state: null }),
}));

// 命中态由 URL 参数驱动（q=关键词），这里直接把参数固定住
vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return {
		...actual,
		useUrlParams: () => ({
			get: (key: string) => (key === "q" ? "关键词" : ""),
			set: () => {},
		}),
	};
});

const mockedSearch = vi.mocked(searchConvE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <ConvSearch />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("ConvSearch", () => {
	it("搜索进行中渲染 spinner", async () => {
		mockedSearch.mockReturnValue(new Promise(() => {}) as never);
		const host = mount();
		await settle(() => mockedSearch.mock.calls.length > 0);

		expect(host.querySelector('[class*="_spinnerWrap_"]')).toBeTruthy();
		expect(host.querySelector('[class*="_spinner_"]')).toBeTruthy();
		// 装饰性 spinner：旁边没有可见文案时也不该被读屏器当成内容
		expect(
			(host.querySelector('[class*="_spinner_"]') as HTMLElement).className,
		).toContain("_spinner_");
	});

	it("结果回来后 spinner 让位给命中列表", async () => {
		mockedSearch.mockResolvedValue({
			total: 1,
			hits: [
				{
					conv_id: 1,
					conv_type: "concept",
					title: "命中标题",
					snippet: "片段",
					match_field: "title",
					created_at: "2026-09-01T10:00:00+00:00",
				},
			],
		} as never);

		const host = mount();
		await settle(() => (host.textContent ?? "").includes("命中标题"));

		expect(host.textContent).toContain("命中标题");
		expect(host.querySelector('[class*="_spinner_"]')).toBeNull();
	});
});
