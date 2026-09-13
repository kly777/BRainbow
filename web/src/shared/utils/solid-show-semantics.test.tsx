// ── Solid 语义钉子：<Show> 的子节点什么时候会更新 ──
// 这个文件不是业务测试，而是把"我们踩过的那类 bug 的框架语义"固定下来 ——
// 框架升级/换实现时它会立刻告诉我们假设是否还成立。
//
// 背景（真实缺陷，见 doc/frontend-ui-architecture.md P1-6）：
// `/file/:id` 切换上一个/下一个时图片不换。原因不是 <Show> 不更新，而是
// **子节点里把 accessor 读了一次、再把"值"传给了下一个组件**：
//
//   <Show when={resolved()}>{(url) => props.children(url())}</Show>
//                                        ^^^^^^^ 读一次 → 之后是死值
//
// 装好的 solid-js 实现（dist/solid.js）是：
//   conditionValue = createMemo(() => props.when)                 // 无 equals，值变就通知
//   condition      = keyed ? conditionValue : createMemo(..., equals: (a,b) => !a === !b)
//   子节点函数收到的 accessor 读的是 **conditionValue**（每次都通知），
//   但外层 condition 的 equals 让"真 → 真"的变化不重建子节点。
// 于是两条推论，正好对应下面两组断言：
//   ① accessor 在**被追踪的位置**读（如 src={x()}）→ 会更新；
//   ② accessor 读一次、把值传下去（或存进变量）→ 冻结，必须加 keyed。

import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";

function mount(node: () => ReturnType<typeof Show>): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

describe("非 keyed 的 Show：值在真→真之间变化", () => {
	it("子节点里直接读 accessor（被追踪）→ 跟着更新", () => {
		const [v, setV] = createSignal<string | undefined>("a");
		const host = mount(() => (
			<Show when={v()}>{(x) => <p data-probe="">{x()}</p>}</Show>
		));
		expect(host.textContent).toBe("a");
		setV("b");
		expect(host.textContent).toBe("b");
	});

	it("子节点里读一次、把值当参数传给别的函数 → 冻结（这就是那个 bug）", () => {
		const [v, setV] = createSignal<string | undefined>("a");
		const render2 = (value: string) => <p data-probe="">{value}</p>;
		const host = mount(() => <Show when={v()}>{(x) => render2(x())}</Show>);
		expect(host.textContent).toBe("a");
		setV("b");
		// 仍然是旧值 —— 不是 bug，是语义：子节点没有被重建
		expect(host.textContent).toBe("a");
	});

	it("keyed 时子节点随值重建（实参是值本身）", () => {
		const [v, setV] = createSignal<string | undefined>("a");
		const host = mount(() => (
			<Show when={v()} keyed>
				{(value) => <p data-probe="">{value}</p>}
			</Show>
		));
		expect(host.textContent).toBe("a");
		setV("b");
		expect(host.textContent).toBe("b");
	});
});

describe("非 keyed 的 Show：真假切换时子节点会重建", () => {
	it("经过一次 undefined 再回来 → 用的是新值（资源通常走这条路）", () => {
		const [v, setV] = createSignal<string | undefined>("a");
		const render2 = (value: string) => <p data-probe="">{value}</p>;
		const host = mount(() => <Show when={v()}>{(x) => render2(x())}</Show>);
		setV(undefined);
		setV("b");
		expect(host.textContent).toBe("b");
	});
});
