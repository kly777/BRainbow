// ── PreBlock：行号 + 换行开关 + 复制全文 ──
//
// 重点是**行号的实现代价**：它必须是一个文本节点，而不是"一行一个 <li>"—— 大日志
// 十万行，十万个 DOM 节点的渲染代价正是当初给文本预览设上限的原因。这里用**节点数**
// 直接钉住这条约定（把实现改回 <ol> 会立刻挂）。

import { copyTextWithToast } from "@shared/utils";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countLines, numberingOf, PreBlock } from "./PreBlock.tsx";

vi.mock("@shared/utils", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@shared/utils")>();
	return { ...actual, copyTextWithToast: vi.fn() };
});

function mount(text: string) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <PreBlock text={text} />, host);
	return host;
}

const buttonWith = (host: HTMLElement, label: string) =>
	Array.from(host.querySelectorAll("button")).find((b) =>
		(b.textContent ?? "").includes(label),
	);

afterEach(() => {
	vi.clearAllMocks();
});

describe("countLines / numberingOf", () => {
	it("行数：末行没有换行符也算一行", () => {
		expect(countLines("")).toBe(0);
		expect(countLines("a")).toBe(1);
		expect(countLines("a\nb")).toBe(2);
		expect(countLines("a\nb\n")).toBe(3);
	});

	it("编号串逐行递增", () => {
		expect(numberingOf(1)).toBe("1");
		expect(numberingOf(3)).toBe("1\n2\n3");
	});
});

describe("PreBlock", () => {
	it("默认给出行号与行数，且行号不是逐行 DOM 节点", () => {
		const host = mount("第一行\n第二行\n第三行");
		expect(host.textContent).toContain("3 行");
		const gutter = host.querySelector("[aria-hidden='true']");
		expect(gutter?.textContent).toBe("1\n2\n3");

		// 节点数约定：正文 + 行号 = 2 个文本节点（<ol><li> 那样会是每行一个）
		expect(host.querySelectorAll("li")).toHaveLength(0);
		expect(host.querySelectorAll("pre")).toHaveLength(2);
	});

	it("十万行的行号仍只有两个文本节点（大文件不炸 DOM）", () => {
		// 造 5 万行（十万行在这里没必要，同一量级即可说明问题）
		const text = Array.from({ length: 50_000 }, (_, i) => `line ${i}`).join(
			"\n",
		);
		const host = mount(text);
		const pre = host.querySelectorAll("pre");
		expect(pre).toHaveLength(2);
		expect(pre[1]?.textContent?.length).toBe(text.length);
		// 行号列的最后一行编号正确（拼串没漏）
		expect(pre[0]?.textContent?.endsWith("\n50000")).toBe(true);
	});

	it("单行文本不给行号（没意义）", () => {
		const host = mount("就一行");
		expect(host.querySelector("[aria-hidden='true']")).toBeNull();
	});

	it("切到自动换行时收起行号（折行会让编号错位）", async () => {
		const host = mount("aaaa\nbbbb");
		expect(host.querySelector("[aria-hidden='true']")).not.toBeNull();

		buttonWith(host, "自动换行")?.click();
		await Promise.resolve();
		expect(host.querySelector("[aria-hidden='true']")).toBeNull();
		expect(buttonWith(host, "不换行")).toBeDefined();
		// 正文仍完整
		expect(host.querySelectorAll("pre")[0]?.textContent).toBe("aaaa\nbbbb");
	});

	it("复制全文把原文交给剪贴板工具", () => {
		const host = mount("a\nb");
		buttonWith(host, "复制全文")?.click();
		expect(vi.mocked(copyTextWithToast)).toHaveBeenCalledWith("a\nb");
	});
});
