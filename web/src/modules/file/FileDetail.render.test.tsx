// ── FileDetail 渲染回归 ──
// 本页做过两处结构性改动，这组断言就是为它们兜底：
//   1. 迁到 `DetailPage` 外壳 —— 返回栏由外壳提供，h1 走 `titleHidden`（sr-only，
//      因为返回栏已展示文件名，可见标题重复没有意义）；
//   2. 编辑表单改用 `Field` + `Input` —— label 关联与 id 由原语生成；
//   3. 「上一个/下一个」切换时**媒体元素必须跟着换**（`<Show>` 非 keyed 会把首帧的
//      src 冻住：usePreviewUrl 在公开文件上是"直接替换真值"，条件始终为真，
//      Show 的子节点不会重建，于是图片停在上一个文件的 URL 上）。

import { getFile, listFiles } from "@modules/file/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileDetailPage from "./FileDetail.tsx";

vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return {
		...actual,
		getFile: vi.fn(),
		listFiles: vi.fn().mockResolvedValue({
			items: [],
			page: 1,
			page_size: 20,
			total: 0,
			total_pages: 0,
		}),
		updateFile: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		listFileTags: vi.fn().mockResolvedValue([]),
	};
});

// 路由参数要用**响应式**的替身：切换上一个/下一个时 hook 的 createResource 靠
// params 变化重取数据，静态对象测不出这条链路（真实 router 的 params 也是信号）
const route = vi.hoisted(() => ({ set: (_id: string) => {} }));
vi.mock("@solidjs/router", async () => {
	const { createSignal } = await import("solid-js");
	const [routeId, setRouteId] = createSignal("abc123");
	route.set = setRouteId;
	return {
		// navigate("/file/imgB") → 改参数，模拟真实跳转
		useNavigate: () => (to: string) =>
			setRouteId(String(to).split("/").filter(Boolean).pop() ?? ""),
		useParams: () => ({
			get id() {
				return routeId();
			},
		}),
		useLocation: () => ({
			pathname: `/file/${routeId()}`,
			search: "",
			hash: "",
			query: {},
			// 带上来源列表 URL，页面才会去取"同批文件"（← → 依赖它）
			state: { from: "/file?page=1" },
		}),
	};
});

vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return {
		...actual,
		copyTextWithToast: vi.fn(),
		notifySuccess: vi.fn(),
		notifyError: vi.fn(),
		showConfirm: vi.fn().mockResolvedValue(true),
	};
});

const mockedGetFile = vi.mocked(getFile);
const mockedListFiles = vi.mocked(listFiles);

const file = {
	id: 1,
	stored_id: "abc123",
	url: "/api/file/abc123/data/报告.pdf",
	original_name: "报告.pdf",
	mime_type: "application/pdf",
	file_category: "document" as const,
	size_bytes: 2048,
	width: null,
	height: null,
	duration_ms: null,
	tags: ["工作"],
	meta: { 作者: "我" },
	created_at: "2026-09-09T13:00:00+00:00",
	updated_at: "2026-09-09T13:00:00+00:00",
	missing: false,
	is_private: false,
	can_edit: true,
};

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <FileDetailPage />, host);
	return host;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockedGetFile.mockResolvedValue(file as never);
});

const imageA = {
	...file,
	id: 1,
	stored_id: "imgA",
	url: "/api/file/imgA/data/a.png",
	original_name: "a.png",
	mime_type: "image/png",
	file_category: "image" as const,
};
const imageB = {
	...imageA,
	id: 2,
	stored_id: "imgB",
	url: "/api/file/imgB/data/b.png",
	original_name: "b.png",
};

describe("FileDetail：切换上一个/下一个", () => {
	it("点「下一个」后图片 src 跟着换（曾因 <Show> 未加 keyed 而停在上一个文件）", async () => {
		// 初始就在第一张图上（默认参数是 abc123，必须显式设置，否则会"假通过"：
		// 取数落到 fallback 分支、下一个按钮处于禁用态，怎么断言都是绿的）
		route.set("imgA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);
		mockedListFiles.mockResolvedValue({
			items: [imageA, imageB],
			page: 1,
			page_size: 100,
			total: 2,
			total_pages: 1,
		} as never);

		const host = mount();
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageA.url,
		);
		// 先确认基线：确实停在第一张图，且"下一个"可用
		expect(host.querySelector("img")?.getAttribute("src")).toBe(imageA.url);
		const next = Array.from(host.querySelectorAll("button")).find((b) =>
			b.getAttribute("title")?.startsWith("下一个"),
		);
		expect(next?.disabled).toBe(false);

		next?.click();

		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageB.url,
		);
		expect(host.querySelector("img")?.getAttribute("src")).toBe(imageB.url);
		// 页面其它部分本来就跟着换（证明问题只出在媒体元素上）
		expect(host.querySelector("h1")?.textContent).toBe("b.png");
	});
});

describe("FileDetail：切换途中不插骨架", () => {
	it("切换时旧内容留在原位，只标 aria-busy（曾因骨架与旧内容同时渲染而下沉）", async () => {
		route.set("imgA");
		mockedListFiles.mockResolvedValue({
			items: [imageA, imageB],
			page: 1,
			page_size: 100,
			total: 2,
			total_pages: 1,
		} as never);
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);

		const host = mount();
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageA.url,
		);

		// 让"下一个"的取数挂起，模拟慢网络下的切换中间态
		let release = () => {};
		mockedGetFile.mockImplementation(async (id: string) => {
			if (id === "imgA") return imageA as never;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return imageB as never;
		});

		Array.from(host.querySelectorAll("button"))
			.find((b) => b.getAttribute("title")?.startsWith("下一个"))
			?.click();
		await settle(() => host.querySelector("[aria-busy='true']") !== null);

		// 关键断言：骨架不在（它曾在旧内容上方多渲染一块，把整页顶下去）
		expect(host.querySelector("[aria-label='加载中']")).toBeNull();
		// 旧内容还在原位，只是被标成"正在更新"
		expect(host.querySelector("img")?.getAttribute("src")).toBe(imageA.url);

		release();
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageB.url,
		);
		expect(host.querySelector("[aria-busy='true']")).toBeNull();
	});
});

describe("FileDetail：切换上一个/下一个（HTML 文本预览）", () => {
	it("切到下一个 html 文件后 iframe 的 srcdoc 跟着换", async () => {
		const htmlA = {
			...file,
			stored_id: "htmlA",
			url: "/api/file/htmlA/data/a.html",
			original_name: "a.html",
			mime_type: "text/html",
			file_category: "text" as const,
		};
		const htmlB = {
			...htmlA,
			stored_id: "htmlB",
			url: "/api/file/htmlB/data/b.html",
			original_name: "b.html",
		};
		route.set("htmlA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "htmlA" ? htmlA : htmlB) as never,
		);
		mockedListFiles.mockResolvedValue({
			items: [htmlA, htmlB],
			page: 1,
			page_size: 100,
			total: 2,
			total_pages: 1,
		} as never);
		// 文本预览自己去 fetch 内容
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async (url: string) =>
					new Response(url.includes("htmlB") ? "<p>B</p>" : "<p>A</p>"),
			),
		);

		const host = mount();
		await settle(
			() => host.querySelector("iframe")?.getAttribute("srcdoc") === "<p>A</p>",
		);
		expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
			"<p>A</p>",
		);

		Array.from(host.querySelectorAll("button"))
			.find((b) => b.getAttribute("title")?.startsWith("下一个"))
			?.click();

		await settle(
			() => host.querySelector("iframe")?.getAttribute("srcdoc") === "<p>B</p>",
		);
		expect(host.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
			"<p>B</p>",
		);
		vi.unstubAllGlobals();
	});
});

describe("FileDetail：DetailPage 迁移后的回归", () => {
	it("渲染唯一的 h1，且为 sr-only（返回栏已展示文件名）", async () => {
		const host = mount();
		await settle(() => host.querySelector("h1")?.textContent === "报告.pdf");
		const h1 = host.querySelectorAll("h1");
		expect(h1.length).toBe(1);
		expect(h1[0].textContent).toBe("报告.pdf");
		expect(h1[0].className).toContain("sr-only");
	});

	it("返回栏与动作区由外壳提供", async () => {
		const host = mount();
		await flush();
		expect(host.textContent).toContain("文件列表");
		expect(host.textContent).toContain("编辑");
		expect(host.textContent).toContain("删除");
	});

	it("加载完成后渲染文件信息", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("报告.pdf"));
		expect(host.textContent).toContain("报告.pdf");
		expect(host.textContent).toContain("工作");
	});

	it("加载失败显示错误态而不是卡在骨架屏", async () => {
		mockedGetFile.mockRejectedValue(new Error("文件接口不可用"));
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("文件接口不可用"));
		expect(mockedGetFile).toHaveBeenCalled();
		expect(host.textContent).toContain("文件接口不可用");
		expect(host.textContent).toContain("重试");
	});

	it("编辑态：文件名走 Field + Input，label 的 for 指向 input 的 id", async () => {
		const host = mount();
		await settle(() => (host.textContent ?? "").includes("编辑"));

		const editBtn = Array.from(host.querySelectorAll("button")).find(
			(b) => b.textContent?.trim() === "编辑",
		);
		editBtn?.click();
		await flush();

		const label = Array.from(host.querySelectorAll("label")).find(
			(l) => l.textContent?.trim() === "文件名",
		);
		expect(label).toBeTruthy();
		// 原语生成 id 并自动关联：这张断言就是 P1-4 之后新增的 Field 契约
		expect(label?.getAttribute("for")).toBeTruthy();
		const input = host.querySelector("input");
		expect(input?.id).toBe(label?.getAttribute("for"));
	});
});
