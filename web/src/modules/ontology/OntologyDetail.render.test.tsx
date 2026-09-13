// ── OntologyDetail 编辑表单：控件原语化后的关联契约 ──
// 这一页的两个控件从裸 <input> / <textarea> 换成了 <Input> / <Textarea>。
// 迁移最容易丢的是 **label 的 for 与控件 id 的关联** —— 裸元素时代靠手写 id 撑着，
// 换成原语后一旦漏传 id，可访问名就没了（改造前全站 93 个文本控件里 27 个没有可访问名，
// 正是这类问题）。所以这里钉两件事：关联仍在、控件确实是原语（连自写类都不该有）。

import Input from "@components/ui/atoms/Input.tsx";
import Textarea from "@components/ui/atoms/Textarea.tsx";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getOntoE, updateOntoE } from "./api";
import OntologyDetail from "./OntologyDetail.tsx";

vi.mock("./api", () => ({
	getOntoE: vi.fn(),
	updateOntoE: vi.fn(),
	deleteOntoE: vi.fn(),
}));

vi.mock("@solidjs/router", () => ({
	useNavigate: () => vi.fn(),
	useParams: () => ({ id: "7" }),
}));

const mockedGet = vi.mocked(getOntoE);
const mockedUpdate = vi.mocked(updateOntoE);

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = "";
	mockedGet.mockResolvedValue({
		id: 7,
		name: "本体甲",
		description: "描述甲",
	} as never);
});

/** 渲染页面并点「编辑」进入编辑态 */
async function mountAndEdit(): Promise<HTMLDivElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => <OntologyDetail />, host);

	await settle(() => (host.textContent ?? "").includes("本体甲"));
	const edit = buttonByText(host, "编辑");
	edit?.click();
	await settle(() => host.querySelector("#onto-name") !== null);
	return host;
}

function buttonByText(host: HTMLElement, text: string) {
	return Array.from(host.querySelectorAll("button")).find(
		(b) => b.textContent?.trim() === text,
	);
}

function inputText(control: HTMLElement | null, value: string) {
	if (!control) throw new Error("控件不存在");
	(control as HTMLInputElement).value = value;
	control.dispatchEvent(new Event("input", { bubbles: true }));
}

/** 渲染一个参照原语，取它的类名 —— 用来判断页面上的控件是不是同一个原语形态 */
function referenceClass(node: () => JSX.Element): string {
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(node, host);
	const cls = host.querySelector("input,textarea")?.className ?? "";
	host.remove();
	return cls;
}

describe("OntologyDetail 编辑表单", () => {
	it("两个控件的 label 都指向真实存在的可输入控件", async () => {
		const host = await mountAndEdit();

		const labels = Array.from(host.querySelectorAll("label[for]"));
		expect(labels.map((l) => l.getAttribute("for"))).toEqual([
			"onto-name",
			"onto-desc",
		]);
		for (const label of labels) {
			const control = host.querySelector(`#${label.getAttribute("for")}`);
			expect(control).not.toBeNull();
			expect(["INPUT", "TEXTAREA"]).toContain(control?.tagName);
		}
	});

	it('控件就是 <Input tone="bg"> / <Textarea tone="bg">，没有自写控件类', async () => {
		const host = await mountAndEdit();

		expect(host.querySelector("#onto-name")?.className).toBe(
			referenceClass(() => <Input tone="bg" />),
		);
		expect(host.querySelector("#onto-desc")?.className).toBe(
			referenceClass(() => <Textarea tone="bg" />),
		);
	});

	it("编辑后保存，提交去掉首尾空白的值与当前 id", async () => {
		const host = await mountAndEdit();
		mockedUpdate.mockResolvedValue(undefined as never);

		inputText(host.querySelector("#onto-desc"), "  新描述  ");
		buttonByText(host, "保存")?.click();
		await settle(() => mockedUpdate.mock.calls.length > 0);

		expect(mockedUpdate).toHaveBeenCalledWith(7, {
			name: "本体甲",
			description: "新描述",
		});
	});

	it("名称清空后「保存」不可用（守原有校验）", async () => {
		const host = await mountAndEdit();

		inputText(host.querySelector("#onto-name"), "   ");
		await settle(() => true);

		expect(buttonByText(host, "保存")?.disabled).toBe(true);
	});
});
