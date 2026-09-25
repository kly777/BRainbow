// ── Button 契约测试 ──
// 此前是"自我满足型"：`expect(typeof Button).toBe("function")` 加上遍历一个字面量数组
// 断言 `toBeDefined()` —— 把 8 个 variant 的类名映射全改错它也照样绿。
// 这里钉住真正会被改坏的东西：variant / size → 类名、默认 type、可访问名、
// 原生属性透传与点击/禁用行为。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "./Button.tsx";

const VARIANTS = [
	"primary",
	"secondary",
	"outline",
	"danger",
	"dangerSolid",
	"warningSolid",
	"ghost",
	"icon",
] as const;

function mount(ui: () => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(ui, host);
}

const button = () => document.querySelector("button") as HTMLButtonElement;

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Button", () => {
	it("默认 type=button：放进表单也不会误触发提交", () => {
		mount(() => <Button>确定</Button>);
		expect(button().type).toBe("button");
		expect(button().textContent).toBe("确定");
	});

	it("type 可显式覆盖为 submit", () => {
		mount(() => <Button type="submit">提交</Button>);
		expect(button().type).toBe("submit");
	});

	it("8 个 variant 各自映射到不同类名（映射表错位会被抓住）", () => {
		const seen = new Set<string>();
		for (const v of VARIANTS) {
			mount(() => <Button variant={v}>{v}</Button>);
			const cls = button().className;
			expect(cls).toContain(`_${v}_`);
			expect(cls).toContain("_btn_");
			seen.add(cls);
		}
		expect(seen.size).toBe(VARIANTS.length);
	});

	it("size 两档：默认 md，sm 可切", () => {
		mount(() => <Button>默认</Button>);
		expect(button().className).toContain("_md_");

		mount(() => <Button size="sm">小</Button>);
		expect(button().className).toContain("_sm_");
	});

	it("调用方 class 追加在自身类名之后（便于覆盖）", () => {
		mount(() => <Button class="mine">x</Button>);
		const cls = button().className;
		expect(cls).toContain("_btn_");
		expect(cls.endsWith("mine")).toBe(true);
	});

	it("ariaLabel 落到 aria-label（图标按钮的唯一可访问名）", () => {
		mount(() => (
			<Button variant="icon" ariaLabel="关闭">
				×
			</Button>
		));
		expect(button().getAttribute("aria-label")).toBe("关闭");
	});

	it("原生属性原样透传：ref / disabled / data-*", () => {
		let captured: HTMLButtonElement | undefined;
		mount(() => (
			<Button
				ref={(el: HTMLButtonElement) => (captured = el)}
				disabled
				data-testid="b"
			>
				x
			</Button>
		));
		expect(captured).toBe(button());
		expect(button().disabled).toBe(true);
		expect(button().getAttribute("data-testid")).toBe("b");
	});

	it("点击触发回调；禁用时不触发", () => {
		const onClick = vi.fn();
		mount(() => <Button onClick={onClick}>点我</Button>);
		button().click();
		expect(onClick).toHaveBeenCalledTimes(1);

		mount(() => (
			<Button onClick={onClick} disabled>
				点我
			</Button>
		));
		button().click();
		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
