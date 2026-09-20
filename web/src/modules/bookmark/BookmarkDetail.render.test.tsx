// ── BookmarkDetail 渲染测试 ──
// 这个页面刚做过结构整理（查看/编辑两个视图拆到 components/，EditForm 的 17 个
// props 收成整个 hook 一束）。断言锁住对外行为：查看态渲染标题/URL/标签，
// 点「编辑」切到表单且表单里带着原有标签（标签输入走共享 TagInput 的适配器）。

import { getBookmarkE } from "@modules/bookmark";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookmarkDetail from "./BookmarkDetail.tsx";

vi.mock("@modules/bookmark", () => ({
	getBookmarkE: vi.fn(),
	deleteBookmarkE: vi.fn(),
	updateBookmarkE: vi.fn(),
	setBookmarkTagsE: vi.fn(),
	suggestBookmarkTagsE: vi.fn(),
	searchBookmarkTagsE: vi.fn(async () => []),
	deleteBookmarkTagE: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({ id: "3" }),
}));

const mockedGet = vi.mocked(getBookmarkE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <BookmarkDetail />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGet.mockResolvedValue({
		id: 3,
		title: "一篇好文",
		url: "https://example.com/post",
		description: "值得再看",
		tags: ["工作", "前端"],
		created_at: "2026-09-01T10:00:00+00:00",
		updated_at: "2026-09-02T10:00:00+00:00",
	} as never);
});

describe("BookmarkDetail", () => {
	it("查看态渲染标题 / URL / 备注 / 标签", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("一篇好文"));

		expect(host.textContent).toContain("一篇好文");
		expect(host.textContent).toContain("https://example.com/post");
		expect(host.textContent).toContain("值得再看");
		expect(host.textContent).toContain("工作");
		expect(host.textContent).toContain("前端");
	});

	it("点「编辑」切到表单，表单里带着原有的标题与标签", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("一篇好文"));

		const edit = Array.from(host.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "编辑",
		) as HTMLButtonElement;
		edit.click();
		await flush();

		// 表单的字段（标签输入是共享 TagInput 的适配器：chips + 输入框）
		expect(host.textContent).toContain("编辑书签");
		const inputs = Array.from(host.querySelectorAll("input"));
		expect((inputs[0] as HTMLInputElement).value).toBe("一篇好文");
		expect((inputs[1] as HTMLInputElement).value).toBe(
			"https://example.com/post",
		);
		const tagBox = host.querySelector(
			"input[aria-label='添加标签']",
		) as HTMLInputElement;
		expect(tagBox).toBeTruthy();
		// 已选标签仍是 chips（两枚），标签输入框是空的
		expect(tagBox.value).toBe("");
		expect(host.textContent).toContain("工作");
		expect(host.textContent).toContain("前端");
	});
});
