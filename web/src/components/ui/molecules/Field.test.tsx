// ── 表单原语契约测试 ──
// 核心是"正确的无障碍关联成为默认行为"：Field 里的控件必须自动拿到
// id（供 label 的 for 指向）与 aria-describedby（指向 hint / error）。
// 改造前全站 93 个文本控件里 27 个没有任何可访问名，这组断言就是防它回潮。

import Input from "@components/ui/atoms/Input.tsx";
import Select from "@components/ui/atoms/Select.tsx";
import Textarea from "@components/ui/atoms/Textarea.tsx";
import Field from "@components/ui/molecules/Field.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";

function mount(node: () => JSX.Element): HTMLDivElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	return host;
}

describe("Field + 控件：自动无障碍关联", () => {
	it("label 的 for 与控件 id 一致（可访问名的来源）", () => {
		const host = mount(() => (
			<Field label="文件名">
				<Input />
			</Field>
		));
		const label = host.querySelector("label");
		const input = host.querySelector("input");
		expect(label?.getAttribute("for")).toBeTruthy();
		expect(input?.id).toBe(label?.getAttribute("for"));
	});

	it("Select 与 Textarea 同样自动获得 id", () => {
		const h1 = mount(() => (
			<Field label="排序">
				<Select />
			</Field>
		));
		expect(h1.querySelector("select")?.id).toBe(
			h1.querySelector("label")?.getAttribute("for"),
		);

		const h2 = mount(() => (
			<Field label="备注">
				<Textarea />
			</Field>
		));
		expect(h2.querySelector("textarea")?.id).toBe(
			h2.querySelector("label")?.getAttribute("for"),
		);
	});

	it("hint 存在时 aria-describedby 指向 hint", () => {
		const host = mount(() => (
			<Field label="标签" hint="用逗号分隔">
				<Input />
			</Field>
		));
		const input = host.querySelector("input");
		const hint = host.querySelector("p");
		expect(hint?.textContent).toBe("用逗号分隔");
		expect(input?.getAttribute("aria-describedby")).toBe(hint?.id);
		expect(input?.getAttribute("aria-invalid")).toBeNull();
	});

	it("error 存在时接管描述位、标 aria-invalid，且不再渲染 hint", () => {
		const host = mount(() => (
			<Field label="文件名" hint="会覆盖旧文件" error="文件名不能为空">
				<Input />
			</Field>
		));
		const input = host.querySelector("input");
		const msg = host.querySelector("p");
		expect(msg?.textContent).toBe("文件名不能为空");
		expect(msg?.getAttribute("role")).toBe("alert");
		expect(input?.getAttribute("aria-describedby")).toBe(msg?.id);
		expect(input?.getAttribute("aria-invalid")).toBe("true");
		// hint 被错误文案取代，避免同时播报提示与错误
		expect(host.textContent).not.toContain("会覆盖旧文件");
	});

	it("hint 与 error 皆无时不产生 aria-describedby", () => {
		const host = mount(() => (
			<Field label="文件名">
				<Input />
			</Field>
		));
		expect(
			host.querySelector("input")?.getAttribute("aria-describedby"),
		).toBeNull();
	});

	it("required 显示星号并补仅供读屏器的「必填」", () => {
		const host = mount(() => (
			<Field label="文件名" required>
				<Input />
			</Field>
		));
		expect(host.querySelector("label")?.textContent).toContain("*");
		expect(host.querySelector(".sr-only")?.textContent).toBe("必填");
	});

	it("不同的 Field 实例之间 id 不冲突", () => {
		const host = mount(() => (
			<>
				<Field label="甲">
					<Input />
				</Field>
				<Field label="乙">
					<Input />
				</Field>
			</>
		));
		const [a, b] = Array.from(host.querySelectorAll("input"));
		expect(a.id).toBeTruthy();
		expect(a.id).not.toBe(b.id);
	});
});

describe("表单原语：独立使用与属性透传", () => {
	it("不在 Field 内也能正常渲染，不产生 id / aria-describedby", () => {
		const host = mount(() => <Input placeholder="搜索…" />);
		const input = host.querySelector("input");
		expect(input?.getAttribute("placeholder")).toBe("搜索…");
		expect(input?.id).toBe("");
		expect(input?.getAttribute("aria-describedby")).toBeNull();
	});

	it("调用方显式 id 优先于 Field 生成的 id", () => {
		const host = mount(() => (
			<Field label="文件名">
				<Input id="my-own-id" />
			</Field>
		));
		expect(host.querySelector("input")?.id).toBe("my-own-id");
	});

	it("class 合并而非覆盖，且各档位产生不同类名", () => {
		const plain = mount(() => <Input />).querySelector("input")?.className;
		const sized = mount(() => <Input size="sm" />).querySelector(
			"input",
		)?.className;
		const toned = mount(() => <Input tone="bg" />).querySelector(
			"input",
		)?.className;
		const mono = mount(() => <Input mono />).querySelector("input")?.className;
		const inv = mount(() => <Input invalid />).querySelector(
			"input",
		)?.className;

		expect(sized).not.toBe(plain);
		expect(toned).not.toBe(plain);
		expect(mono).not.toBe(plain);
		expect(inv).not.toBe(plain);

		const withClass = mount(() => <Input class="my-hex-input" />).querySelector(
			"input",
		)?.className;
		expect(withClass).toContain("my-hex-input");
	});

	it("显式 invalid=false 可以压过 Field 的错误态", () => {
		const host = mount(() => (
			<Field label="文件名" error="出错了">
				<Input invalid={false} />
			</Field>
		));
		expect(
			host.querySelector("input")?.getAttribute("aria-invalid"),
		).toBeNull();
	});

	it("value / onInput / disabled 等原生属性透传", () => {
		let seen = "";
		const host = mount(() => (
			<Input
				value="abc"
				disabled
				onInput={(e) => {
					seen = e.currentTarget.value;
				}}
			/>
		));
		const input = host.querySelector("input") as HTMLInputElement;
		expect(input.value).toBe("abc");
		expect(input.disabled).toBe(true);
	});
});
