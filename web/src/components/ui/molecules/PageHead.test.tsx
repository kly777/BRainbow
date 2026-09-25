// ── PageHead 契约测试 ──
// 此前是自我满足型：断言传入的对象字面量自己的字段存在，与组件无关。
// 这里钉住页头的两条结构契约：唯一 h1、desc/actions 都是可选的槽位。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import PageHead from "./PageHead.tsx";

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

describe("PageHead", () => {
	it("标题渲染为页面唯一的 h1（列表页的 h1 由它保证）", () => {
		const host = mount(() => <PageHead title="任务" />);
		const h1s = host.querySelectorAll("h1");
		expect(h1s).toHaveLength(1);
		expect(h1s[0].textContent).toBe("任务");
	});

	it("desc 可选：不传就不出说明行", () => {
		const host = mount(() => <PageHead title="设置" />);
		expect(host.querySelector("p")).toBeNull();

		mount(() => <PageHead title="设置" desc="系统与账号" />);
		expect(document.querySelector("p")?.textContent).toBe("系统与账号");
	});

	it("actions 槽位原样渲染在自己的容器里", () => {
		const host = mount(() => (
			<PageHead
				title="文件"
				actions={
					<button type="button" data-testid="act">
						上传
					</button>
				}
			/>
		));
		const act = host.querySelector('[data-testid="act"]');
		expect(act).toBeTruthy();
		// 槽位外面包一层容器（页头右侧动作区），不是塞进标题里
		expect(act?.closest("h1")).toBeNull();
	});
});
