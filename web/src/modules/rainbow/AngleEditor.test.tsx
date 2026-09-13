// ── AngleEditor：数值框原语化后的行为回归 ──
// 该组件把 <input type="text" inputmode="decimal"> 换成了 <Input tone="bg">。
// 原语通过 splitProps + {...rest} 透传原生属性，所以这里要钉住三件事：
// ① 原生属性（inputmode / value / 键盘与焦点回调）确实透传；
// ② 控件就是原语形态（只多一个域内布局类：固定宽度、右对齐）；
// ③ 模式切换仍会把外部角度按当前单位重算 —— 这是它最容易被顺手改坏的行为。

import Input from "@components/ui/atoms/Input.tsx";
import { Angle } from "@shared/utils";
import { createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import AngleEditor from "./AngleEditor.tsx";

function referenceClass(node: () => JSX.Element): string {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	const cls = host.querySelector("input")?.className ?? "";
	host.remove();
	return cls;
}

function mount(initial = 0) {
	const [angle, setAngle] = createSignal(Angle.fromDegree(initial));
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <AngleEditor angle={angle} setAngle={setAngle} />, host);
	return { host, angle };
}

const numberInput = (host: HTMLElement) =>
	host.querySelector<HTMLInputElement>("input:not([type='range'])");

const modeButton = (host: HTMLElement, label: string) =>
	Array.from(host.querySelectorAll("button")).find(
		(b) => b.textContent?.trim() === label,
	);

describe("AngleEditor", () => {
	it("数值框保留原生 inputmode 与初始值（原语透传原生属性）", () => {
		const { host } = mount(30);
		const input = numberInput(host);
		expect(input?.getAttribute("inputmode")).toBe("decimal");
		expect(input?.value).toBe("30.00");
	});

	it('数值框就是 <Input tone="bg"> 加一个域内布局类', () => {
		const { host } = mount(30);
		const base = referenceClass(() => <Input tone="bg" />);
		const cls = numberInput(host)?.className ?? "";
		expect(cls).toContain(base);
		const extra = cls
			.slice(cls.indexOf(base) + base.length)
			.trim()
			.split(/\s+/)
			.filter(Boolean);
		expect(extra).toHaveLength(1);
	});

	it("输入数字后把角度写回（按当前单位为度）", () => {
		const { host, angle } = mount(0);
		const input = numberInput(host);
		if (input) {
			input.value = "45";
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}
		expect(angle().degree).toBeCloseTo(45, 6);
	});

	it("切到弧度时数值框按新单位重算，单位标签同步", () => {
		const { host } = mount(90);
		modeButton(host, "弧度")?.click();
		expect(host.textContent).toContain("rad");
		const expected = (Math.PI / 2).toFixed(4);
		expect(numberInput(host)?.value).toBe(expected);
	});

	it("输入无法解析的内容回落到 0（不抛错、不留脏值）", () => {
		const { host, angle } = mount(30);
		const input = numberInput(host);
		if (input) {
			input.value = "abc";
			input.dispatchEvent(new Event("input", { bubbles: true }));
		}
		expect(angle().degree).toBe(0);
	});
});
