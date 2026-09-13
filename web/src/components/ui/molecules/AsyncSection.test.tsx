// ── AsyncSection：详情页四态互斥渲染契约 ──
// 这个原语存在的理由就是"互斥"：改造前 /file/:id 把骨架与内容写成两个独立 <Show>，
// 后台刷新时两者同时命中（resource 保留旧值），骨架插在旧内容上方把整块内容顶下去。
// 因此这里钉的是四态**选一**，以及两个顺序性决定：
//   ① 错误优先于骨架（错误是终态信息，不该被骨架挡住 —— P1-5 的形状）；
//   ② refreshing 只加 aria-busy，绝不换成骨架（布局零位移）。

import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";
import { AsyncSection } from "./AsyncSection.tsx";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

const content = (host: HTMLElement) => host.querySelector("[data-content]");
const skeleton = (host: HTMLElement) =>
	host.querySelector("[aria-label='加载中'], .skeleton");

describe("AsyncSection", () => {
	it("loading：渲染骨架，不渲染内容", () => {
		const host = mount(() => (
			<AsyncSection
				data={() => undefined}
				loading={() => true}
				error={() => undefined}
				onRetry={() => {}}
			>
				{() => <p data-content="">内容</p>}
			</AsyncSection>
		));
		expect(skeleton(host)).not.toBeNull();
		expect(content(host)).toBeNull();
	});

	it("error 优先于 loading：错误不该被骨架挡住（P1-5）", () => {
		const host = mount(() => (
			<AsyncSection
				data={() => undefined}
				loading={() => true}
				error={() => new Error("炸了")}
				onRetry={() => {}}
			>
				{() => <p data-content="">内容</p>}
			</AsyncSection>
		));
		expect(host.textContent).toContain("炸了");
		expect(skeleton(host)).toBeNull();
		expect(content(host)).toBeNull();
	});

	it("错误态给出重试入口", () => {
		const onRetry = vi.fn();
		const host = mount(() => (
			<AsyncSection
				data={() => undefined}
				loading={() => false}
				error={() => new Error("网络错误")}
				onRetry={onRetry}
			>
				{() => <p data-content="">内容</p>}
			</AsyncSection>
		));
		Array.from(host.querySelectorAll("button"))
			.find((b) => b.textContent?.includes("重试"))
			?.click();
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it("没数据也没错误：给空态文案", () => {
		const host = mount(() => (
			<AsyncSection
				data={() => undefined}
				loading={() => false}
				error={() => undefined}
				onRetry={() => {}}
				emptyMessage="没有这个文件"
			>
				{() => <p data-content="">内容</p>}
			</AsyncSection>
		));
		expect(host.textContent).toContain("没有这个文件");
		expect(content(host)).toBeNull();
	});

	it("有数据：渲染内容并传入 accessor（值会跟着变）", () => {
		const [v, setV] = createSignal<string | undefined>("a");
		const host = mount(() => (
			<AsyncSection
				data={v}
				loading={() => false}
				error={() => undefined}
				onRetry={() => {}}
			>
				{(data) => <p data-content="">{data()}</p>}
			</AsyncSection>
		));
		expect(host.textContent).toBe("a");
		setV("b");
		expect(host.textContent).toBe("b");
	});

	it("refreshing：保留内容、只加 aria-busy（不换成骨架）", () => {
		const [refreshing, setRefreshing] = createSignal(true);
		const host = mount(() => (
			<AsyncSection
				data={() => "旧数据"}
				loading={() => false}
				error={() => undefined}
				onRetry={() => {}}
				refreshing={refreshing}
			>
				{(data) => <p data-content="">{data()}</p>}
			</AsyncSection>
		));
		expect(content(host)).not.toBeNull();
		expect(host.textContent).toContain("旧数据");
		expect(skeleton(host)).toBeNull();
		expect(host.querySelector("[aria-busy='true']")).not.toBeNull();

		setRefreshing(false);
		expect(host.querySelector("[aria-busy='true']")).toBeNull();
	});

	it("class 落在内容容器上（页面布局类由调用方给）", () => {
		const host = mount(() => (
			<AsyncSection
				data={() => "x"}
				loading={() => false}
				error={() => undefined}
				onRetry={() => {}}
				class="probe-layout"
			>
				{() => <p data-content="">内容</p>}
			</AsyncSection>
		));
		expect(host.firstElementChild?.className).toContain("probe-layout");
	});
});
