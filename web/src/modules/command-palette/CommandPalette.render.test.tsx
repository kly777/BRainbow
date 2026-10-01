// @vitest-environment jsdom
// ── 命令面板的键盘与 a11y 契约 ──
//
// 钉住四件"平时看不见、坏了很难查"的事：
//   1. 打开后焦点在输入框，关闭后**还给**打开前的元素（否则键盘用户被丢到 body）
//   2. Tab 不把焦点带到面板背后（声明了 aria-modal 就得像模态）
//   3. aria-activedescendant 指向当前高亮项，且它确实是可选项 —— DOM 焦点始终留在
//      输入框（离了它输入法就坏），读屏靠这个属性知道高亮在哪
//   4. 选中项**永不落在分组标题**上：多分组搜索结果的首项就是标题，落在标题上时
//      回车会执行它的空动作然后静默关掉面板

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchE } from "./api.ts";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));

vi.mock("@solidjs/router", () => ({ useNavigate: () => navigateMock }));
vi.mock("@app/context/auth.tsx", () => ({
	useAuth: () => ({ auth: () => ({ user: null }), logout: vi.fn() }),
}));
vi.mock("@modules/ai-setting", () => ({ openAiSettings: vi.fn() }));
vi.mock("./api.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./api.ts")>();
	return { ...actual, searchE: vi.fn() };
});

const mockedSearch = vi.mocked(searchE);

/** 等一个条件成立（防抖 300ms + 微任务） */
async function waitFor(check: () => boolean, tries = 60) {
	for (let i = 0; i < tries && !check(); i++) {
		await new Promise((r) => setTimeout(r, 20));
	}
}

const paletteInput = () =>
	document.querySelector<HTMLInputElement>('[role="combobox"]');

function key(target: EventTarget, init: KeyboardEventInit) {
	target.dispatchEvent(
		new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
	);
}

async function mountPalette() {
	const { default: CommandPalette } = await import("./CommandPalette.tsx");
	const host = document.createElement("div");
	document.body.appendChild(host);
	const dispose = render(() => <CommandPalette />, host);
	await Promise.resolve();
	return { host, dispose };
}

/** 两条不同 kind 的命中 → 至少两个分组（首项是分组标题） */
const twoGroupHits = () =>
	({
		hits: [
			{
				kind: "file",
				id: 1,
				title: "会议记录.txt",
				snippet: "定了报销与排期",
				target: { type: "File", params: { stored_id: "abc" } },
				score: 1,
			},
			{
				kind: "card",
				id: 2,
				title: "会议卡片",
				snippet: "会后跟进",
				target: { type: "Text", params: {} },
				score: 1,
			},
		],
	}) as never;

beforeEach(() => {
	document.body.innerHTML = "";
	vi.clearAllMocks();
	// jsdom 没实现 scrollIntoView：面板的选中项会自动滚入视野（rAF 里调用）
	Element.prototype.scrollIntoView = vi.fn();
	mockedSearch.mockResolvedValue(twoGroupHits());
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("命令面板的键盘与 a11y 契约", () => {
	it("打开时聚焦输入框，关闭后焦点还给打开前的元素", async () => {
		const { dispose } = await mountPalette();
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		key(document.body, { key: "k", ctrlKey: true });
		expect(paletteInput()).toBeTruthy();
		expect(document.activeElement).toBe(paletteInput());

		key(paletteInput() as Element, { key: "Escape" });
		await Promise.resolve(); // 焦点归还是微任务
		expect(document.activeElement).toBe(trigger);

		dispose();
	});

	it("Tab 被拦下：焦点不出面板（声明了 aria-modal 就得像模态）", async () => {
		const { dispose } = await mountPalette();
		key(document.body, { key: "k", ctrlKey: true });

		const input = paletteInput() as HTMLInputElement;
		const tab = new KeyboardEvent("keydown", {
			key: "Tab",
			bubbles: true,
			cancelable: true,
		});
		input.dispatchEvent(tab);

		expect(tab.defaultPrevented).toBe(true);
		expect(input.isConnected).toBe(true);
		dispose();
	});

	it("高亮项是可选项、aria-activedescendant 指向它（不落在分组标题上）", async () => {
		const { dispose } = await mountPalette();
		key(document.body, { key: "k", ctrlKey: true });

		const input = paletteInput() as HTMLInputElement;
		input.value = "?会议";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitFor(
			() => document.querySelectorAll('[role="option"]').length >= 2,
		);

		const activeId = input.getAttribute("aria-activedescendant");
		expect(activeId).toBeTruthy();
		const active = document.getElementById(activeId as string);
		expect(active?.getAttribute("role")).toBe("option");
		expect(active).toBe(document.querySelector('[role="option"]'));
		// 关联到 listbox（combobox 规范）
		expect(input.getAttribute("aria-controls")).toBe(
			document.querySelector('[role="listbox"]')?.id,
		);

		dispose();
	});

	it("有一个可见的关闭按钮（窄屏用，CSS 控制显隐），点它关面板", async () => {
		const { dispose } = await mountPalette();
		key(document.body, { key: "k", ctrlKey: true });

		const close = document.querySelector(
			'button[aria-label="关闭"]',
		) as HTMLElement;
		expect(close).toBeTruthy();
		close.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
		expect(paletteInput()).toBeNull();

		dispose();
	});

	it("无前缀打开就列出可跳页面；打字给「在站内搜索」一行，选中即切 ? 模式", async () => {
		const { dispose } = await mountPalette();
		key(document.body, { key: "k", ctrlKey: true });

		// 空输入不再是空白面板：直接列出可跳页面
		expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(
			0,
		);

		const input = paletteInput() as HTMLInputElement;
		input.value = "文件";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitFor(() =>
			(document.body.textContent ?? "").includes("在站内搜索"),
		);

		const rows = [...document.querySelectorAll('[role="option"]')];
		const searchRow = rows.at(-1) as HTMLElement;
		expect(searchRow.textContent).toContain("在站内搜索「文件」");

		// 选中它：留在面板里、切到 `?` 模式（输入框前缀跟着变），而不是直接跳走
		searchRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await Promise.resolve();
		expect(paletteInput()?.value).toBe("?文件");
		expect(navigateMock).not.toHaveBeenCalled();

		dispose();
	});

	it("多分组结果下回车执行第一条可选项（此前会选到标题上、静默关面板）", async () => {
		const { dispose } = await mountPalette();
		key(document.body, { key: "k", ctrlKey: true });

		const input = paletteInput() as HTMLInputElement;
		input.value = "?会议";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await waitFor(
			() => document.querySelectorAll('[role="option"]').length >= 2,
		);

		key(input, { key: "Enter" });
		expect(navigateMock).toHaveBeenCalledTimes(1);
		// 选中项是文件详情（第一条可选项），不是分组标题
		expect(navigateMock).toHaveBeenCalledWith("/file/abc");

		dispose();
	});
});
