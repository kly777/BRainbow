// ── CaptureInput 渲染测试 ──
// 主要锁三件事：
//  1. 回车提交的载荷（标题/优先级/标签/时长）与"提交后清空 + 焦点留在框里"（A3）；
//  2. 两层是同一份状态：第 2 层改优先级/标签，标题行的 token 跟着变（反之亦然）；
//  3. 空标题（纯符号 / 纯空白）不能提交（A1）。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import CaptureInput, { type CaptureSubmit } from "./CaptureInput.tsx";

function mount(
	onSubmit: (payload: CaptureSubmit) => void | boolean | Promise<void | boolean>,
) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <CaptureInput onSubmit={onSubmit} />, host);
	return host;
}

/** 等到 onSubmit 返回的 promise 落地（清空/还原都在 await 之后发生） */
const flush = () => new Promise((r) => setTimeout(r, 0));

const titleInput = (host: HTMLElement) =>
	host.querySelector<HTMLInputElement>(
		'input[aria-label^="任务标题"]',
	) as HTMLInputElement | null;

function type(input: HTMLInputElement, value: string) {
	input.value = value;
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

function press(input: HTMLInputElement, key: string, shift = false) {
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key, shiftKey: shift, bubbles: true }),
	);
}

describe("CaptureInput：第 1 层", () => {
	it("回车提交解析后的载荷", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;

		type(input, "写周报 !p1 #工作 @bob ~60m");
		press(input, "Enter");

		expect(onSubmit).toHaveBeenCalledTimes(1);
		const payload = onSubmit.mock.calls[0][0] as CaptureSubmit;
		expect(payload.title).toBe("写周报");
		expect(payload.priority).toBe("p1");
		expect(payload.tags).toEqual(["工作"]);
		expect(payload.effortMinutes).toBe(60);
		expect(payload.description).toBe("> 提及：@bob");
	});

	it("提交后清空，焦点留在标题框（连续录入的命门，A3）", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;
		input.focus();

		type(input, "写周报");
		press(input, "Enter");

		expect(input.value).toBe("");
		expect(document.activeElement).toBe(input);
	});

	// 回归：创建失败（如标题超 255 被后端 400 拒）时，用户写的内容必须还在。
	// 此前是先清空再 await 提交、失败又没提示，等同静默丢数据。
	it("提交失败时把原文放回输入框，焦点也留在框里", async () => {
		const host = mount(() => false);
		const input = titleInput(host) as HTMLInputElement;
		input.focus();

		type(input, "很长很长很长很长很长很长很长很长很长很长很长的标题".repeat(10));
		press(input, "Enter");
		await flush();

		expect(input.value.length).toBeGreaterThan(0);
		expect(input.value.startsWith("很长很长")).toBe(true);
		expect(document.activeElement).toBe(input);
	});

	it("提交失败时第 2 层的日期与父任务也一并还原", async () => {
		const host = mount(() => false);
		const input = titleInput(host) as HTMLInputElement;
		input.focus();

		type(input, "写周报");
		// 用 ↓ 唤出第 2 层（见 onKeyDown 的 ArrowDown 分支）
		press(input, "ArrowDown");
		const dateInput = host.querySelector<HTMLInputElement>(
			'input[data-testid="capture-due"], input[id="capture-due"]',
		) as HTMLInputElement | null;
		// 第 2 层是原生 datetime-local；填上值即可，不必逐个控件断言
		if (dateInput) {
			dateInput.value = "2026-10-20T15:00";
			dateInput.dispatchEvent(new Event("change", { bubbles: true }));
		}
		press(input, "Enter");
		await flush();

		expect(input.value).toBe("写周报");
		if (dateInput) {
			expect(dateInput.value).toBe("2026-10-20T15:00");
		}
	});

	it("提交成功（onSubmit 返回 true）时清空，与 void 返回值一视同仁", async () => {
		const host = mount(() => true);
		const input = titleInput(host) as HTMLInputElement;
		input.focus();

		type(input, "写周报");
		press(input, "Enter");
		await flush();

		expect(input.value).toBe("");
	});

	it("Shift+Enter 提交但不清空（连写多条）", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;

		type(input, "写周报");
		press(input, "Enter", true);

		expect(onSubmit).toHaveBeenCalledTimes(1);
		expect(input.value).toBe("写周报");
	});

	it("空标题不提交：纯符号（A1）", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;

		type(input, "!p1 #工作 ~60m");
		press(input, "Enter");

		expect(onSubmit).not.toHaveBeenCalled();
		expect(host.textContent).toContain("只有符号没有标题");
	});

	it("空标题不提交：纯空白", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;

		type(input, "   ");
		press(input, "Enter");

		expect(onSubmit).not.toHaveBeenCalled();
	});

	it("实时预览把解析结果显示出来，未识别的也说明白", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;

		type(input, "写周报 !p9");
		expect(host.textContent).toContain("没认出来");

		type(input, "写周报 !p1 #家 ~30m");
		expect(host.textContent).toContain("P1");
		expect(host.textContent).toContain("#家");
		expect(host.textContent).toContain("⏱30m");
	});
});

describe("CaptureInput：两层是同一份状态", () => {
	const openPanel = (host: HTMLElement) => {
		const button = host.querySelector<HTMLButtonElement>(
			'button[aria-controls="capture-panel"]',
		) as HTMLButtonElement;
		button.click();
		return host.querySelector<HTMLElement>("#capture-panel");
	};

	it("展开后出现第 2 层的控件，焦点仍在标题框", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;
		input.focus();
		const panel = openPanel(host);

		expect(panel).not.toBeNull();
		expect(host.querySelector("#capture-due")).not.toBeNull();
		expect(host.querySelector("#capture-start")).not.toBeNull();
		expect(host.querySelector("#capture-priority")).not.toBeNull();
		expect(host.querySelector("#capture-effort")).not.toBeNull();
		expect(document.activeElement).toBe(input);
	});

	it("下拉里选 p2 → 标题行里的 `!p1` 变成 `!p2`（回写而不是两份状态）", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;
		type(input, "写周报 !p1");
		openPanel(host);

		const select = host.querySelector<HTMLSelectElement>(
			"#capture-priority",
		) as HTMLSelectElement;
		select.value = "p2";
		select.dispatchEvent(new Event("change", { bubbles: true }));

		expect(input.value).toBe("写周报 !p2");
	});

	it("标题行写 `#工作` → 第 2 层的标签 chip 出现", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;
		openPanel(host);

		type(input, "买牛奶 #工作");
		const panel = host.querySelector("#capture-panel") as HTMLElement;
		expect(panel.textContent).toContain("工作");
	});

	it("时长输入框落定后写回 `~60m`", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;
		type(input, "写周报");
		openPanel(host);

		const effort = host.querySelector<HTMLInputElement>(
			"#capture-effort",
		) as HTMLInputElement;
		effort.value = "60";
		effort.dispatchEvent(new Event("input", { bubbles: true }));
		effort.dispatchEvent(new Event("change", { bubbles: true }));

		expect(input.value).toBe("写周报 ~60m");
	});

	it("第 2 层填的日期进载荷（标题行里没有日期的位置）", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;
		openPanel(host);

		const due = host.querySelector<HTMLInputElement>(
			"#capture-due",
		) as HTMLInputElement;
		type(due, "2026-10-09 15:00");
		due.dispatchEvent(new Event("blur", { bubbles: true }));

		type(input, "写周报");
		press(input, "Enter");

		const payload = onSubmit.mock.calls[0][0] as CaptureSubmit;
		expect(payload.dueAt).not.toBeNull();
		expect(new Date(payload.dueAt as string).getMinutes()).toBe(0);
	});

	it("Esc 收起第 2 层（不提交）", () => {
		const onSubmit = vi.fn();
		const host = mount(onSubmit);
		const input = titleInput(host) as HTMLInputElement;
		type(input, "写周报");
		openPanel(host);

		press(input, "Escape");

		expect(host.querySelector("#capture-panel")).toBeNull();
		expect(onSubmit).not.toHaveBeenCalled();
		expect(input.value).toBe("写周报");
	});

	it("↓ 也能唤出第 2 层（键盘不必去够 [+]）", () => {
		const host = mount(vi.fn());
		const input = titleInput(host) as HTMLInputElement;

		press(input, "ArrowDown");

		expect(host.querySelector("#capture-panel")).not.toBeNull();
	});
});
