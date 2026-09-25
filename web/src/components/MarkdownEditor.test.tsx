// ── MarkdownEditor：插入格式 + 文件能力的注入接缝 ──
// 背景一：编辑器曾调用已删除的 media 模块（上传 404），而该路径当时没有任何测试
// 覆盖，直到手动粘贴图片才暴露 —— buildMarkdownRef 因此抽成纯函数并钉住。
// 背景二：编辑器原先硬引 file 模块（上传实现与挑选器都是内置默认），共享层因此
// 反向依赖业务模块。现在两者都靠 props 注入：没注入就不出现对应 UI（也不承诺）。
// 背景三：粘贴/拖入上传失败时原先 `catch { /* 全局 toast 已处理 */ }` —— 这条链走
// XHR、不经过 handleGlobalError，4xx 时是**静默失败**（不插入也没有任何提示）。

import { notifyError } from "@shared/utils";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownEditor, {
	buildMarkdownRef,
	type MarkdownFileRef,
} from "./MarkdownEditor.tsx";

// 只静音通知；其余（tryAsync 等）走原实现
vi.mock("@shared/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@shared/utils")>()),
	notifyError: vi.fn(),
}));

describe("buildMarkdownRef", () => {
	it("图片用 Markdown 图片语法", () => {
		expect(
			buildMarkdownRef("image/png", "/api/file/abc/data/a.png", "a.png"),
		).toBe("![](/api/file/abc/data/a.png)");
	});

	it("SVG 也按图片处理", () => {
		expect(
			buildMarkdownRef("image/svg+xml", "/api/file/x/data/i.svg", "i.svg"),
		).toBe("![](/api/file/x/data/i.svg)");
	});

	it("非图片用链接语法（通用文件服务可存任意类型）", () => {
		expect(
			buildMarkdownRef("application/pdf", "/api/file/x/data/r.pdf", "报告.pdf"),
		).toBe("[报告.pdf](/api/file/x/data/r.pdf)");
		expect(
			buildMarkdownRef(
				"application/octet-stream",
				"/api/file/x/data/m.ply",
				"model.ply",
			),
		).toBe("[model.ply](/api/file/x/data/m.ply)");
	});
});

// ── 注入接缝 ──

function mount(props: Parameters<typeof MarkdownEditor>[0]) {
	document.body.innerHTML = "";
	const el = document.createElement("div");
	document.body.appendChild(el);
	render(() => <MarkdownEditor {...props} />, el);
}

/** 假挑选器：把 isOpen 摊在 DOM 上（可真断言的响应式输出），点击即回调 onPick */
function makePicker() {
	const pick: MarkdownFileRef = {
		url: "/api/file/f/data/x.png",
		name: "x.png",
		mime: "image/png",
	};
	const filePicker = (props: {
		isOpen: boolean;
		onClose: () => void;
		onPick: (f: MarkdownFileRef) => void;
	}) => (
		<button
			type="button"
			data-testid="picker"
			data-open={String(props.isOpen)}
			onClick={() => props.onPick(pick)}
		>
			picker
		</button>
	);
	return { filePicker, pick };
}

const findButton = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent === label,
	) as HTMLButtonElement | undefined;

const pickerOpenState = () =>
	document.querySelector('[data-testid="picker"]')?.getAttribute("data-open");

/** 等一拍：Solid 的更新在微任务里落地 */
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
	document.body.innerHTML = "";
});

describe("MarkdownEditor 的文件能力靠注入", () => {
	it("什么都没注入时不出现工具栏（不承诺插入/拖入文件）", () => {
		mount({ value: "", onInput: () => {} });
		expect(document.body.textContent).not.toContain("插入文件");
		expect(document.body.textContent).not.toContain("拖入文件");
	});

	it("注入挑选器后出现「插入文件」，点击才把 isOpen 打开", async () => {
		const { filePicker } = makePicker();
		mount({ value: "", onInput: () => {}, filePicker });

		const btn = findButton("插入文件");
		expect(btn).toBeTruthy();
		expect(pickerOpenState()).toBe("false");

		btn?.click();
		await flush();
		expect(pickerOpenState()).toBe("true");
	});

	it("注入上传实现才出现粘贴/拖入提示", () => {
		mount({
			value: "",
			onInput: () => {},
			onUploadFile: async () => ({ url: "/u", name: "n", mime: "image/png" }),
		});
		expect(document.body.textContent).toContain("拖入文件");
		expect(document.body.textContent).not.toContain("插入文件");
	});

	it("挑选文件后插到光标处（图片用 ![]()）", async () => {
		const onInput = vi.fn();
		const { filePicker, pick } = makePicker();
		mount({ value: "前", onInput, filePicker });

		// 光标放到开头，断言"插在光标处"而不是"追加到末尾"
		const ta = document.querySelector("textarea") as HTMLTextAreaElement;
		ta.setSelectionRange(0, 0);

		(
			document.querySelector('[data-testid="picker"]') as HTMLButtonElement
		).click();
		await flush();

		expect(onInput).toHaveBeenCalledWith(`![](${pick.url})\n前`);
	});

	it("粘贴文件上传失败时给出提示（不是静默失败）", async () => {
		const onUploadFile = vi.fn(async () => {
			throw new Error("上传失败（HTTP 413）");
		});
		mount({ value: "", onInput: () => {}, onUploadFile });

		const ta = document.querySelector("textarea") as HTMLTextAreaElement;
		const file = new File(["x"], "big.png", { type: "image/png" });
		const ev = new Event("paste") as Event & { clipboardData: unknown };
		Object.defineProperty(ev, "clipboardData", {
			value: {
				items: [{ kind: "file", getAsFile: () => file }],
				getData: () => "",
			},
		});
		ta.dispatchEvent(ev);
		await flush();

		expect(onUploadFile).toHaveBeenCalledTimes(1);
		expect(vi.mocked(notifyError)).toHaveBeenCalledWith(
			"插入文件失败",
			expect.any(Error),
		);
	});
});
