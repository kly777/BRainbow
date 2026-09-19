// ── FileDetail 渲染回归 ──
// 本页做过几处结构性改动，这组断言就是为它们兜底：
//   1. 迁到 `DetailPage` 外壳 —— 返回栏由外壳提供，h1 走 `titleHidden`（sr-only，
//      因为返回栏已展示文件名，可见标题重复没有意义）；
//   2. 编辑表单改用 `Field` + `Input` —— label 关联与 id 由原语生成；
//   3. **移除了「上一个/下一个」**：详情页是文件汇集里的一条，相邻文件没有语义关系
//      （曾经用工具栏按钮 + 方向键切，方向键那版会和 3DGS 预览抢事件）。现在只剩
//      "路由参数变化"这一条切换路径（前进/后退、外部链接），组件不重挂只换参数 ——
//      所以媒体元素必须跟着换（`<Show>` 非 keyed 会把首帧的 src 冻住：
//      usePreviewUrl 在公开文件上是"直接替换真值"，条件始终为真，Show 的子节点不会
//      重建，于是图片停在上一个文件的 URL 上）。
//   4. 灯箱只在**当前这张**上放大，不再跨文件翻页（同一条理由）。

import { getFile } from "@modules/file/api.ts";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FileDetailPage from "./FileDetail.tsx";

vi.mock("@modules/file/api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@modules/file/api.ts")>();
	return {
		...actual,
		getFile: vi.fn(),
		updateFile: vi.fn().mockResolvedValue(undefined),
		deleteFile: vi.fn().mockResolvedValue(undefined),
		listFileTags: vi.fn().mockResolvedValue([]),
	};
});

// 路由参数要用**响应式**的替身：参数变化时 hook 的 createResource 靠 params 重取数据，
// 静态对象测不出这条链路（真实 router 的 params 也是信号）
const route = vi.hoisted(() => ({
	set: (_id: string) => {},
	setQuery: (_query: Record<string, string>) => {},
}));
vi.mock("@solidjs/router", async () => {
	const { createSignal } = await import("solid-js");
	const [routeId, setRouteId] = createSignal("abc123");
	const [query, setQuery] = createSignal<Record<string, string>>({});
	route.set = setRouteId;
	route.setQuery = setQuery;
	return {
		// 深链（?view=）走 useSearchParams：返回"响应式对象 + 写入函数"这对形状，
		// 与 @solidjs/router 一致（读要能追踪，所以用 Proxy 把读落到信号上）
		useSearchParams: () => [
			new Proxy(
				{},
				{
					get: (_target, key: string) => query()[key],
				},
			),
			(next: Record<string, string | undefined>) => {
				const patch: Record<string, string> = {};
				for (const [key, value] of Object.entries(next)) {
					if (value !== undefined) patch[key] = value;
				}
				setQuery((current) => ({ ...current, ...patch }));
			},
		],
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
			// 返回栏据此回到来源列表（筛选与页码还在）
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

describe("FileDetail：单个文件，没有跨文件导航", () => {
	it("工具条上没有上一个/下一个（详情页是文件汇集里的一条，相邻文件无语义关系）", async () => {
		route.set("imgA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);

		const host = mount();
		await settle(() => host.querySelector("img") !== null);
		const titles = Array.from(host.querySelectorAll("button")).map((b) =>
			b.getAttribute("title"),
		);
		expect(titles.some((t) => t?.startsWith("上一个"))).toBe(false);
		expect(titles.some((t) => t?.startsWith("下一个"))).toBe(false);
	});

	it("方向键也不切文件（会与 3DGS 预览的相机移动抢事件）", async () => {
		route.set("imgA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);

		const host = mount();
		await settle(() => host.querySelector("img") !== null);
		expect(host.querySelector("h1")?.textContent).toBe("a.png");

		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
		);
		await flush();
		expect(host.querySelector("h1")?.textContent).toBe("a.png");
	});
});

// 跨文件切换虽然不再有按钮，但路由参数仍会变（浏览器前进/后退两个详情页、外部链接），
// 这时组件**不重挂**、只换参数 —— 下面这几条钉住"参数变、内容跟着变"
describe("FileDetail：路由参数变化时内容跟着换", () => {
	it("图片 src 跟着换（曾因 <Show> 未加 keyed 而停在上一个文件）", async () => {
		route.set("imgA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);

		const host = mount();
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageA.url,
		);
		expect(host.querySelector("img")?.getAttribute("src")).toBe(imageA.url);

		route.set("imgB");
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageB.url,
		);
		expect(host.querySelector("img")?.getAttribute("src")).toBe(imageB.url);
		// 页面其它部分本来就跟着换（证明问题只出在媒体元素上）
		expect(host.querySelector("h1")?.textContent).toBe("b.png");
	});

	it("切换途中旧内容留在原位，只标 aria-busy（曾因骨架与旧内容同时渲染而下沉）", async () => {
		route.set("imgA");
		mockedGetFile.mockImplementation(
			async (id: string) => (id === "imgA" ? imageA : imageB) as never,
		);

		const host = mount();
		await settle(
			() => host.querySelector("img")?.getAttribute("src") === imageA.url,
		);

		// 让新文件的取数挂起，模拟慢网络下的切换中间态
		let release = () => {};
		mockedGetFile.mockImplementation(async (id: string) => {
			if (id === "imgA") return imageA as never;
			await new Promise<void>((resolve) => {
				release = resolve;
			});
			return imageB as never;
		});

		route.set("imgB");
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

	it("HTML 文本预览：iframe 的 srcdoc 跟着换", async () => {
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

		route.set("htmlB");
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

describe("FileDetail：两栏可拖拽调宽（P4-4）", () => {
	it("有分隔条；键盘左右方向键调整宽度并记住", async () => {
		const host = mount();
		await settle(() => host.textContent?.includes("报告.pdf") ?? false);

		const splitter = host.querySelector<HTMLElement>("[class*='splitter']");
		expect(splitter).not.toBeNull();
		// 默认宽度写进自定义属性（侧栏宽度读它）
		const body = host.querySelector("[class*='body']") as HTMLElement;
		expect(body.style.getPropertyValue("--side-width")).toBe("288px");

		// 左方向键 = 变宽（分隔条在侧栏左边缘）
		splitter?.dispatchEvent(
			new KeyboardEvent("keydown", {
				key: "ArrowLeft",
				bubbles: true,
				cancelable: true,
			}),
		);
		await Promise.resolve();
		expect(body.style.getPropertyValue("--side-width")).toBe("304px");
		expect(localStorage.getItem("file:detail:side-width")).toBe("304");
	});
});

describe("FileDetail：查看器内部状态可深链（P4-5）", () => {
	it("`?view=hex:4096` 让十六进制预览直接从该偏移取段", async () => {
		// 一个 .bin（other 类别 → 十六进制查看器）：内容请求应带上 Range: bytes=4096-
		const bin = {
			...file,
			stored_id: "binA",
			url: "/api/file/binA/data/a.bin",
			original_name: "a.bin",
			mime_type: "application/octet-stream",
			file_category: "other" as const,
			size_bytes: 65536,
		};
		route.set("binA");
		route.setQuery({ view: "hex:4096" });
		mockedGetFile.mockResolvedValue(bin as never);

		const ranges: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) => {
				const range = new Headers(init?.headers).get("range");
				if (range) ranges.push(range);
				return new Response(new Uint8Array(16), {
					status: 206,
					headers: { "content-range": "bytes 4096-4111/65536" },
				});
			}),
		);

		const host = mount();
		await settle(() => ranges.length > 0);
		// 第一段就应该从 4096 起（而不是从 0 起）
		expect(ranges[0]).toBe("bytes=4096-8191");
		// 分页控件如实显示当前段
		await settle(() => (host.textContent ?? "").includes("00001000"));
		expect(host.textContent).toContain("00001000");
		vi.unstubAllGlobals();
	});

	it("不在 URL 里的查看器不受影响（别人的状态不串台）", async () => {
		const bin = {
			...file,
			stored_id: "binB",
			url: "/api/file/binB/data/a.bin",
			original_name: "a.bin",
			mime_type: "application/octet-stream",
			file_category: "other" as const,
			size_bytes: 65536,
		};
		route.set("binB");
		route.setQuery({ view: "epub:12" });
		mockedGetFile.mockResolvedValue(bin as never);

		const ranges: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) => {
				const range = new Headers(init?.headers).get("range");
				if (range) ranges.push(range);
				return new Response(new Uint8Array(16), {
					status: 206,
					headers: { "content-range": "bytes 0-15/65536" },
				});
			}),
		);

		mount();
		await settle(() => ranges.length > 0);
		expect(ranges[0]).toBe("bytes=0-4095");
		vi.unstubAllGlobals();
	});
});
