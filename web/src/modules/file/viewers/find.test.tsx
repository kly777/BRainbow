// ── 预览内查找（集成）：Ctrl/⌘+F 唤起、计数、Enter 循环、Esc 关闭 ──
//
// 用 PlainTextViewer 跑（它是最薄的路径：TextContent + `text => <pre>`），
// 于是这组断言同时钉住了"查找挂在外壳上"这件事 —— 任何走 TextContent/DocContent
// 的查看器都自动获得查找。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlainTextViewer } from "./PlainTextViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

const TEXT = "第一行 任务\n第二行 任务\n第三行 其他\n";

function mount() {
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => new Response(TEXT)),
	);
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<PlainTextViewer
				item={item({ mime_type: "text/plain", original_name: "a.txt" })}
			/>
		),
		host,
	);
	return host;
}

/** 打开查找并输入关键字 */
async function openFind(host: HTMLElement, query: string) {
	document.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "f",
			ctrlKey: true,
			bubbles: true,
			cancelable: true,
		}),
	);
	await settle(() => host.querySelector("input[type=search]") !== null);
	const input = host.querySelector("input[type=search]") as HTMLInputElement;
	input.value = query;
	input.dispatchEvent(new Event("input", { bubbles: true }));
	await settle(() => (host.textContent ?? "").includes("/"));
	return input;
}

const press = (key: string, shiftKey = false) =>
	document.dispatchEvent(
		new KeyboardEvent("keydown", {
			key,
			shiftKey,
			bubbles: true,
			cancelable: true,
		}),
	);

afterEach(() => {
	vi.unstubAllGlobals();
	window.getSelection()?.removeAllRanges();
});

describe("查找浮层", () => {
	it("默认收起，只有一个「查找」按钮", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);
		expect(host.querySelector("input[type=search]")).toBeNull();
		expect(
			host.querySelector("button[aria-label='在预览中查找']"),
		).not.toBeNull();
	});

	it("Ctrl+F 唤起，输入后给出命中计数", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);

		await openFind(host, "任务");
		expect(host.textContent).toContain("1 / 2");
	});

	it("无结果时说「无结果」，而不是 0/0", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);
		await openFind(host, "不存在的词");
		expect(host.textContent).toContain("无结果");
	});

	it("Enter 到下一处并环形回到第一处；Shift+Enter 反向", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);
		await openFind(host, "任务");
		expect(host.textContent).toContain("1 / 2");

		press("Enter");
		await settle(() => (host.textContent ?? "").includes("2 / 2"));
		expect(host.textContent).toContain("2 / 2");

		// 末尾再按 → 回到第一处（不卡在末尾）
		press("Enter");
		await settle(() => (host.textContent ?? "").includes("1 / 2"));
		expect(host.textContent).toContain("1 / 2");

		press("Enter", true);
		await settle(() => (host.textContent ?? "").includes("2 / 2"));
		expect(host.textContent).toContain("2 / 2");
	});

	it("Esc 关闭并清掉选区", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);
		await openFind(host, "任务");
		expect(window.getSelection()?.rangeCount ?? 0).toBeGreaterThan(0);

		press("Escape");
		await settle(() => host.querySelector("input[type=search]") === null);
		expect(host.querySelector("input[type=search]")).toBeNull();
		expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
	});

	it("换成空查询时提示「输入关键字」（不显示 0/0）", async () => {
		const host = mount();
		await settle(() => host.querySelector("pre") !== null);
		await openFind(host, "任务");
		const input = host.querySelector("input[type=search]") as HTMLInputElement;
		input.value = "   ";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await settle(() => (host.textContent ?? "").includes("输入关键字"));
		expect(host.textContent).toContain("输入关键字");
	});
});
