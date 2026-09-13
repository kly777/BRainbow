// ── 表单控件原语的透传契约 ──
// 这一层被四处迁移依赖，而每处依赖的正是"原生属性原样透传"这一条：
//   · CommandPalette 把 ref 交给 usePalette 做自动聚焦；
//   · AngleEditor 传 inputmode="decimal"、value、onFocus/onBlur/onKeyDown；
//   · BookmarkDetail / OntologyDetail 用调用方 class 承载域内样式（focus 配色、tone）。
// 因此这里逐个钉住透传行为，而不是只看"能渲染"。类名带哈希，故用"是否多出一个类"
// 这种相对断言，不写字面量。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import Input from "./Input.tsx";
import Textarea from "./Textarea.tsx";

function mount(node: () => ReturnType<typeof Input>): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

const cls = (host: HTMLElement, sel = "input") =>
	host.querySelector(sel)?.className ?? "";

function extraClasses(base: string, clsName: string): string[] {
	if (!clsName.startsWith(base)) throw new Error("调用方类不在最前，无法比较");
	return clsName.slice(base.length).trim().split(/\s+/).filter(Boolean);
}

describe("Input / Textarea：原生属性透传", () => {
	it("inputmode / placeholder / value / aria-label 落到真实元素上", () => {
		const host = mount(() => (
			<Input
				inputmode="decimal"
				placeholder="占位"
				value="42"
				aria-label="角度"
			/>
		));
		const input = host.querySelector("input");
		expect(input?.getAttribute("inputmode")).toBe("decimal");
		expect(input?.getAttribute("placeholder")).toBe("占位");
		expect(input?.getAttribute("aria-label")).toBe("角度");
		expect((input as HTMLInputElement)?.value).toBe("42");
	});

	it("ref 回调收到真实元素（命令面板的自动聚焦依赖它）", () => {
		const ref = vi.fn();
		mount(() => <Input ref={ref} />);
		expect(ref).toHaveBeenCalledTimes(1);
		expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
	});

	it("onInput / onFocus / onKeyDown 仍然被调用", () => {
		const onInput = vi.fn();
		const onFocus = vi.fn();
		const onKeyDown = vi.fn();
		const host = mount(() => (
			<Input onInput={onInput} onFocus={onFocus} onKeyDown={onKeyDown} />
		));
		const input = host.querySelector("input");
		if (!input) throw new Error("未渲染 input");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		input.dispatchEvent(new Event("focus"));
		// keydown 在 Solid 里是委托事件（挂在 document 上），必须冒泡才能被收到
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);
		expect(onInput).toHaveBeenCalledTimes(1);
		expect(onFocus).toHaveBeenCalledTimes(1);
		expect(onKeyDown).toHaveBeenCalledTimes(1);
	});

	it("id 与 disabled 原样透传（label 的 for 与禁用态都靠它）", () => {
		const host = mount(() => <Input id="onto-name" disabled />);
		const input = host.querySelector("input");
		expect(input?.id).toBe("onto-name");
		expect(input?.disabled).toBe(true);
	});
});

describe("Input / Textarea：类名组装", () => {
	it("md 尺寸（默认）不产生额外类，sm / lg 各产生一个且互不相同", () => {
		const md = cls(mount(() => <Input />));
		const sm = cls(mount(() => <Input size="sm" />));
		const lg = cls(mount(() => <Input size="lg" />));
		expect(extraClasses(md, sm)).toHaveLength(1);
		expect(extraClasses(md, lg)).toHaveLength(1);
		expect(sm).not.toBe(lg);
	});

	it('tone="bg" 产生一个额外类，默认 surface 不产生', () => {
		const surface = cls(mount(() => <Input />));
		const bg = cls(mount(() => <Input tone="bg" />));
		expect(extraClasses(surface, bg)).toHaveLength(1);
	});

	it("mono 与 invalid 各产生一个额外类", () => {
		const base = cls(mount(() => <Input />));
		expect(extraClasses(base, cls(mount(() => <Input mono />)))).toHaveLength(
			1,
		);
		expect(
			extraClasses(base, cls(mount(() => <Input invalid />))),
		).toHaveLength(1);
	});

	it("调用方 class 拼在最后，且只多这一个（覆盖必定生效）", () => {
		const base = cls(mount(() => <Input />));
		const withClass = cls(mount(() => <Input class="probe-field" />));
		expect(withClass.startsWith(base)).toBe(true);
		expect(extraClasses(base, withClass)).toEqual(["probe-field"]);
	});

	it("Textarea 的类名 = 同参数 Input 的类名 + 一个多行修饰类", () => {
		const input = new Set(cls(mount(() => <Input tone="bg" />)).split(" "));
		const area = new Set(
			cls(
				mount(() => <Textarea tone="bg" />),
				"textarea",
			).split(" "),
		);
		// 修饰类插在中间（control → textarea 修饰 → 尺寸/底色），所以按集合比较
		for (const c of input) expect(area.has(c)).toBe(true);
		expect([...area].filter((c) => !input.has(c))).toHaveLength(1);
	});
});
