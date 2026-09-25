// ── Skeleton 契约测试 ──
// 三种形态（通用横条 / 列表 / 卡片墙）此前只有"页面级间接覆盖"（渲染测试断言骨架
// 消失）。这里钉住各自的语义差别：LoadingSkeleton 是 role=status（会被读屏播报），
// 另两种是 aria-hidden（四态视图自己已交代加载中，重复播报反而吵）。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingSkeleton, SkeletonGrid, SkeletonList } from "./Skeleton.tsx";

function mount(ui: () => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(ui, host);
	return host;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("LoadingSkeleton", () => {
	it("默认 3 行，带 role=status 与可访问名（读屏会播报「加载中」）", () => {
		const host = mount(() => <LoadingSkeleton />);
		const wrap = host.querySelector('[role="status"]');
		expect(wrap?.getAttribute("aria-label")).toBe("加载中");
		expect(host.querySelectorAll('[class*="skeletonRow"]')).toHaveLength(3);
	});

	it("rows 可指定行数", () => {
		const host = mount(() => <LoadingSkeleton rows={5} />);
		expect(host.querySelectorAll('[class*="skeletonRow"]')).toHaveLength(5);
	});

	it("横条宽度递减（视觉上有层次，不是一排等宽块）", () => {
		const host = mount(() => <LoadingSkeleton rows={3} />);
		const widths = [
			...host.querySelectorAll<HTMLElement>('[class*="skeletonBar"]'),
		].map((el) => el.style.width);
		expect(widths).toEqual(["70%", "58%", "46%"]);
	});
});

describe("SkeletonList / SkeletonGrid", () => {
	it("列表形态：三行带缩略块 + 一行短横条，aria-hidden（不重复播报）", () => {
		const host = mount(() => <SkeletonList />);
		const wrap = host.firstElementChild as HTMLElement;
		expect(wrap.getAttribute("aria-hidden")).toBe("true");
		expect(wrap.className).toContain("_skeletonListWrap_");
		expect(host.querySelectorAll('[class*="skeletonListAvatar"]')).toHaveLength(
			3,
		);
		// 第 4 行只有一条短横条（没有缩略块）
		expect(host.querySelectorAll('[class*="skeletonListBar"]')).toHaveLength(4);
		expect(host.querySelector('[class*="skeletonListBarShort"]')).toBeTruthy();
	});

	it("网格形态：8 张卡片骨架，每张三块，aria-hidden", () => {
		const host = mount(() => <SkeletonGrid />);
		const wrap = host.firstElementChild as HTMLElement;
		expect(wrap.getAttribute("aria-hidden")).toBe("true");
		expect(wrap.className).toContain("_skeletonGrid_");
		expect(host.querySelectorAll('[class*="skeletonCard_"]')).toHaveLength(8);
		expect(host.querySelectorAll('[class*="skeletonCardThumb"]')).toHaveLength(
			8,
		);
	});
});
