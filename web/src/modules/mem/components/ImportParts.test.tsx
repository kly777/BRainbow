// ── ImportParts 渲染测试 ──
// 本文件里的默认标签输入框在原语迁移中换掉了裸 `<input>`（原先靠
// `.text-input` 整条自定义样式，取值与原语完全相同，故整条删除、改传
// `tone="bg"`）。这组断言钉住迁移后的契约，另覆盖格式提示与结果页两处无交互
// 的展示分支。

import { render } from "solid-js/web";
import { describe, expect, it, vi } from "vitest";

// ImportResult 里有路由链接 <A>，它必须在 Route 上下文内 —— 单测里替换掉
vi.mock("@solidjs/router", () => ({
	A: (props: { children?: unknown; href?: string }) => (
		<a href={props.href}>{props.children as never}</a>
	),
}));

import { FormatHint, ImportResult, ImportTagInput } from "./ImportParts.tsx";

function mount(node: () => unknown) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node as never, host);
	return host;
}

describe("ImportTagInput", () => {
	it("输入框是表单原语，label 的 for 指向它", () => {
		const host = mount(() => <ImportTagInput value="" onChange={() => {}} />);
		const input = host.querySelector(
			"#import-default-tags",
		) as HTMLInputElement;
		expect(input).toBeTruthy();
		expect(input.className).toContain("_control_");
		const label = host.querySelector("label");
		expect(label?.getAttribute("for")).toBe("import-default-tags");
	});

	it("输入回调当前值", () => {
		const onChange = vi.fn();
		const host = mount(() => <ImportTagInput value="旧" onChange={onChange} />);
		const input = host.querySelector(
			"#import-default-tags",
		) as HTMLInputElement;
		expect(input.value).toBe("旧");
		input.value = "标签1; 标签2";
		input.dispatchEvent(new Event("input", { bubbles: true }));
		expect(onChange).toHaveBeenCalledWith("标签1; 标签2");
	});
});

describe("FormatHint", () => {
	it("粘贴模式与文件模式给出不同的格式说明", () => {
		const paste = mount(() => <FormatHint mode="paste" />);
		const file = mount(() => <FormatHint mode="file" />);
		expect(paste.textContent?.trim()).not.toBe("");
		expect(file.textContent?.trim()).not.toBe("");
		expect(paste.textContent).not.toBe(file.textContent);
	});
});

describe("ImportResult", () => {
	it("展示导入条数", () => {
		const host = mount(() => (
			<ImportResult
				result={{ imported: 3, errors: [] }}
				onContinue={() => {}}
			/>
		));
		expect(host.textContent).toContain("3");
	});

	it("有错误时列出错误", () => {
		const host = mount(() => (
			<ImportResult
				result={{ imported: 1, errors: ["第 2 行格式不对"] }}
				onContinue={() => {}}
			/>
		));
		expect(host.textContent).toContain("第 2 行格式不对");
	});
});
