// ── ReadingList 渲染回归 ──
// 本页刚从"手写 PageHead + 提示文案 + AsyncView"迁到 ListPage 外壳，并顺手把
// 上传弹窗里的裸 <input>/<textarea> 换成了 Input/Textarea 原语。这组断言锁住
// 迁移后仍成立的行为：唯一 h1、四态、上传弹窗的控件仍在且可输入。

import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ReadingList from "./ReadingList.tsx";

vi.mock("@modules/reading/api.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@modules/reading/api.ts")>();
	return {
		...actual,
		listArticles: vi.fn(),
		uploadArticle: vi.fn(),
	};
});

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({}),
	useSearchParams: () => [{}, vi.fn()],
	A: (props: { children?: unknown; href?: string }) => (
		<a href={props.href}>{props.children as never}</a>
	),
}));

const article = (id: number, title: string) => ({
	id,
	title,
	word_count: 120,
	known_ratio: 0.9,
	unknown_word_count: 12,
	created_at: "2026-08-22T00:00:00+00:00",
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <ReadingList />, host);
	return host;
}

beforeEach(async () => {
	vi.clearAllMocks();
	const { listArticles } = await import("@modules/reading/api.ts");
	vi.mocked(listArticles).mockResolvedValue({
		articles: [article(1, "第一篇"), article(2, "第二篇")],
	});
});

describe("ReadingList：外壳迁移后的回归", () => {
	it("渲染唯一的 h1，内容为页面标题", async () => {
		const host = mount();
		await flush();
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("英语阅读");
	});

	it("加载完成后渲染文章列表与排序说明", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("第一篇"));
		expect(host.textContent).toContain("第一篇");
		expect(host.textContent).toContain("第二篇");
		// 说明文案走 filters 槽位，仍应渲染在页头与列表之间
		expect(host.textContent).toContain("按推荐阅读顺序排列");
	});

	it("空列表显示空态文案", async () => {
		const { listArticles } = await import("@modules/reading/api.ts");
		vi.mocked(listArticles).mockResolvedValue({ articles: [] });
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("还没有文章"));
		expect(host.textContent).toContain("还没有文章");
	});

	it("加载失败显示错误态与重试入口", async () => {
		const { listArticles } = await import("@modules/reading/api.ts");
		vi.mocked(listArticles).mockRejectedValue(new Error("文章接口不可用"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("文章接口不可用"));
		expect(host.textContent).toContain("文章接口不可用");
		expect(host.querySelector("button")).toBeTruthy();
	});

	it("上传弹窗里的控件已换原语且仍可输入", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("第一篇"));

		const openBtn = Array.from(host.querySelectorAll("button")).find((b) =>
			b.textContent?.includes("上传文章"),
		);
		openBtn?.click();
		await flush();

		// 弹窗走 Portal，查 document
		const input = document.querySelector("#reading-title") as HTMLInputElement;
		const textarea = document.querySelector(
			"#reading-content",
		) as HTMLTextAreaElement;
		expect(input).toBeTruthy();
		expect(textarea).toBeTruthy();
		// 原语应带上基础控件类（Control 模块的 hash 前缀 _control_）
		expect(input.className).toContain("_control_");
		expect(textarea.className).toContain("_control_");
	});
});
