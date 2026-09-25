// ── TagFilter 契约测试（此前零覆盖，却是 file 与 bookmark 两个模块共用的件）──
// 它由两份同构实现合并而来，差异被参数化成三件：要不要计数、要不要"无标签"项、
// 强调色（后者纯 CSS）。这里钉住其余全部行为：触发器文案、展开/收起、
// 搜索过滤、选中回调、无标签项、活动项标记。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import TagFilter from "./TagFilter.tsx";

const TAGS = [
	{ id: 1, name: "rust" },
	{ id: 2, name: "设计", count: 7 },
	{ id: 3, name: "Rustacean" },
];

let dispose: (() => void) | undefined;

function mount(props: Parameters<typeof TagFilter>[0]) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	dispose = render(() => <TagFilter {...props} />, host);
	return host;
}

const trigger = () => document.querySelector("button") as HTMLButtonElement;
const byText = (text: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => (b.textContent ?? "").trim() === text,
	) as HTMLButtonElement | undefined;
/** 候选带上计数后文案变成"设计7"，用它按前缀找 */
const byTextStarts = (text: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		(b.textContent ?? "").trim().startsWith(text),
	) as HTMLButtonElement | undefined;
const searchBox = () =>
	document.querySelector('input[aria-label="搜索标签"]') as HTMLInputElement;

function search(value: string) {
	const el = searchBox();
	el.value = value;
	el.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(() => {
	dispose?.();
	dispose = undefined;
	document.body.innerHTML = "";
});

describe("TagFilter", () => {
	it("值的空串表示不过滤，触发器显示「全部标签」", () => {
		mount({ value: "", onChange: () => {}, options: () => TAGS });
		expect(trigger().textContent).toContain("全部标签");
		// 收起状态：没有下拉
		expect(searchBox()).toBeNull();
	});

	it("触发器显示当前筛选值", () => {
		mount({ value: "rust", onChange: () => {}, options: () => TAGS });
		expect(trigger().textContent).toContain("rust");
	});

	it("untagged 项被选中时显示它的 label（值本身可能不适合当文案）", () => {
		mount({
			value: "__none__",
			onChange: () => {},
			options: () => TAGS,
			untagged: { value: "__none__", label: "无标签" },
		});
		expect(trigger().textContent).toContain("无标签");
	});

	it("点击触发器展开下拉：搜索框 + 全部标签 + 候选；箭头跟着变", () => {
		mount({ value: "", onChange: () => {}, options: () => TAGS });
		expect(trigger().textContent).toContain("▾");

		trigger().click();
		expect(trigger().textContent).toContain("▴");
		expect(searchBox()).toBeTruthy();
		expect(byText("全部标签")).toBeTruthy();
		expect(byText("rust")).toBeTruthy();
		expect(byText("设计")).toBeTruthy();
	});

	it("搜索按大小写不敏感的子串过滤；无命中时给出空态", () => {
		mount({ value: "", onChange: () => {}, options: () => TAGS });
		trigger().click();

		search("RUST");
		expect(byText("rust")).toBeTruthy();
		expect(byText("Rustacean")).toBeTruthy(); // 子串命中
		expect(byText("设计")).toBeFalsy();

		search("zzz");
		expect(document.body.textContent).toContain("没有匹配的标签");
	});

	it("选中标签：回调标签名、收起下拉、清空搜索词", () => {
		const onChange = vi.fn();
		mount({ value: "", onChange, options: () => TAGS });
		trigger().click();
		search("设");

		byText("设计")?.click();

		expect(onChange).toHaveBeenCalledWith("设计");
		expect(searchBox()).toBeNull(); // 已收起
		trigger().click(); // 再展开时搜索词已清空
		expect(searchBox().value).toBe("");
		expect(byText("rust")).toBeTruthy();
	});

	it("「全部标签」把筛选清空（回调空串）", () => {
		const onChange = vi.fn();
		mount({ value: "rust", onChange, options: () => TAGS });
		trigger().click();

		byText("全部标签")?.click();
		expect(onChange).toHaveBeenCalledWith("");
	});

	it("当前选中项带活动态类", () => {
		mount({ value: "设计", onChange: () => {}, options: () => TAGS });
		trigger().click();

		expect(byText("设计")?.className).toContain("_optionActive_");
		expect(byText("rust")?.className).not.toContain("_optionActive_");
		// value 为空串时"全部标签"那项是活动项
		mount({ value: "", onChange: () => {}, options: () => TAGS });
		trigger().click();
		expect(byText("全部标签")?.className).toContain("_optionActive_");
	});

	it("showCount 才显示使用计数", () => {
		// 默认不显示：候选只有名字
		mount({ value: "", onChange: () => {}, options: () => TAGS });
		trigger().click();
		expect(byText("设计")?.textContent).toBe("设计");
		expect(byText("rust")?.textContent).toBe("rust");

		dispose?.();
		mount({
			value: "",
			onChange: () => {},
			options: () => TAGS,
			showCount: true,
		});
		trigger().click();
		// 有计数的带上数字，没有计数的候选不带多余内容
		expect(byTextStarts("设计")?.textContent).toContain("7");
		expect(byText("rust")?.textContent).toBe("rust");
	});

	it("untagged 时下拉里多一项，选中回调它自己的值", () => {
		const onChange = vi.fn();
		mount({
			value: "",
			onChange,
			options: () => TAGS,
			untagged: { value: "__none__", label: "无标签" },
		});
		trigger().click();

		byText("无标签")?.click();
		expect(onChange).toHaveBeenCalledWith("__none__");
	});

	it("候选还没到（undefined）时下拉只显示「全部标签」，不报错", () => {
		mount({ value: "", onChange: () => {}, options: () => undefined });
		trigger().click();
		expect(byText("全部标签")).toBeTruthy();
		expect(byText("rust")).toBeFalsy();
	});

	it("调用方 class 追加到根元素（模块用自己的强调色）", () => {
		const host = mount({
			value: "",
			onChange: () => {},
			options: () => TAGS,
			class: "mine",
		});
		expect(host.firstElementChild?.className).toContain("mine");
	});
});
