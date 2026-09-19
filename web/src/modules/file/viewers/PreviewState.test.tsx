// ── PreviewState：状态块的三种色调与读屏角色 ──
//
// 这个原语存在的意义就是"同一个意思在哪儿都长一样"，所以它的契约值得钉住：
// 文案必出、加载中出转子、错误用 alert（打断）而加载/空用 status（不打断）。

import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { PreviewState } from "./PreviewState.tsx";

function mount(ui: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => ui() as never, host);
	return host;
}

describe("PreviewState", () => {
	it("出主文案与补充说明；默认是「还没内容」的语调（role=status）", () => {
		const host = mount(() => (
			<PreviewState
				message="这个压缩包里没有条目"
				hint="下载后可用本地工具打开"
			/>
		));
		expect(host.textContent).toContain("这个压缩包里没有条目");
		expect(host.textContent).toContain("下载后可用本地工具打开");
		expect(host.querySelector("[role='status']")).not.toBeNull();
		expect(host.querySelector("[role='alert']")).toBeNull();
	});

	it("出错用 alert（读屏会打断播报）", () => {
		const host = mount(() => <PreviewState message="加载失败" tone="error" />);
		expect(host.querySelector("[role='alert']")?.textContent).toContain(
			"加载失败",
		);
		expect(host.querySelector("[role='status']")).toBeNull();
	});

	it("加载中出转子（reduced-motion 由 CSS 停住）", () => {
		const host = mount(() => <PreviewState loading message="正在解析文档…" />);
		expect(host.textContent).toContain("正在解析文档…");
		expect(host.querySelector("[class*='previewStateSpin']")).not.toBeNull();
	});

	it("不给 icon 时没有图标区（纯文字状态不该留一块空位）", () => {
		const host = mount(() => <PreviewState message="就一句话" />);
		expect(host.querySelector("[class*='previewStateIcon']")).toBeNull();
	});

	it("按钮区只在给了 children 时出现", () => {
		const withActions = mount(() => (
			<PreviewState message="x">
				<button type="button">重试</button>
			</PreviewState>
		));
		expect(withActions.querySelector("button")?.textContent).toBe("重试");

		const withoutActions = mount(() => <PreviewState message="x" />);
		expect(
			withoutActions.querySelector("[class*='previewStateActions']"),
		).toBeNull();
	});
});
