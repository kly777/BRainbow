// ── Badge 契约测试 ──
// 此前是自我满足型：断言一个字面量数组长度是 8，与组件毫无关系。
// 这里钉住 variant → 类名映射与默认值。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import Badge from "./Badge.tsx";

const VARIANTS = [
	"default",
	"new",
	"learning",
	"review",
	"relearning",
	"suspended",
	"success",
	"warning",
] as const;

function mount(ui: () => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(ui, host);
}

const badge = () => document.querySelector("span") as HTMLSpanElement;

afterEach(() => {
	document.body.innerHTML = "";
});

describe("Badge", () => {
	it("渲染成 span 并带上基础类与文案", () => {
		mount(() => <Badge>新卡</Badge>);
		expect(badge().tagName).toBe("SPAN");
		expect(badge().className).toContain("_badge_");
		expect(badge().textContent).toBe("新卡");
	});

	it("默认 variant 是 default", () => {
		mount(() => <Badge>x</Badge>);
		expect(badge().className).toContain("_default_");
	});

	it("8 个 variant 各自映射到不同类名", () => {
		const seen = new Set<string>();
		for (const v of VARIANTS) {
			mount(() => <Badge variant={v}>{v}</Badge>);
			expect(badge().className).toContain(`_${v}_`);
			seen.add(badge().className);
		}
		expect(seen.size).toBe(VARIANTS.length);
	});
});
