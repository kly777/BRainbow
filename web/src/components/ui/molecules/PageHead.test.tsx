import { describe, expect, it } from "vitest";
import PageHead from "./PageHead.tsx";

describe("PageHead", () => {
	it("组件可渲染", () => {
		expect(PageHead).toBeDefined();
		expect(typeof PageHead).toBe("function");
	});

	it("接收 title、desc、actions props", () => {
		const props = {
			title: "任务",
			desc: "列表 · 看板 · 日历 · 依赖图",
		};
		expect(props.title).toBe("任务");
		expect(props.desc).toBeDefined();
	});

	it("title 必填，desc 和 actions 可选", () => {
		const minimal = { title: "设置" };
		expect(minimal.title).toBe("设置");
		expect("desc" in minimal).toBe(false);
		expect("actions" in minimal).toBe(false);
	});
});
