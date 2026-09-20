// ── ImageLightbox：翻页时图片必须跟着换 + 键盘/遮罩交互 ──
// 这组断言来自一个真实缺陷：`<Show>` 没加 `keyed` 时，翻页只是把"一个对象换成另一个对象"，
// 真假没变 → 子节点不重建 → `<img src>` / `alt` 停在第一张（页码、标题都变了，图没变）。
// 图片源走 usePreviewUrl：公开图片是同步替换真值，正好落进这个坑。
//
// 注意组件用 <Portal> 渲染到 document.body，所以断言要查 document 而不是 mount 的宿主。

import type { JSX } from "solid-js";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileItem } from "../api.ts";
import ImageLightbox from "./ImageLightbox.tsx";

function image(storedId: string, name: string): FileItem {
	return {
		id: storedId.length,
		stored_id: storedId,
		url: `/api/file/${storedId}/data/${name}`,
		original_name: name,
		mime_type: "image/png",
		file_category: "image",
		size_bytes: 1024,
		width: 100,
		height: 100,
		duration_ms: null,
		tags: [],
		created_at: "2026-09-09T13:00:00+00:00",
		updated_at: "2026-09-09T13:00:00+00:00",
		missing: false,
		is_private: false,
		can_edit: true,
	};
}

const items = [image("aaa", "a.png"), image("bbb", "b.png")];

/** 受控组件：自己持有 index 才能测"翻页后 DOM 是否跟着换" */
function mount() {
	const [index, setIndex] = createSignal(0);
	const onClose = vi.fn();
	render(
		() =>
			(
				<ImageLightbox
					items={items}
					index={index()}
					onClose={onClose}
					onNavigate={setIndex}
				/>
			) as unknown as JSX.Element,
		document.body,
	);
	return { index, onClose };
}

const img = () => document.querySelector("img");
const navButton = (label: string) =>
	document.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);

beforeEach(() => {
	document.body.innerHTML = "";
	// jsdom 不实现 Element.prototype.scrollTo，而组件在图片变化时会用它重置滚动位置
	Object.defineProperty(Element.prototype, "scrollTo", {
		value: vi.fn(),
		writable: true,
		configurable: true,
	});
});

describe("ImageLightbox", () => {
	it("初始显示第一张", () => {
		mount();
		expect(img()?.getAttribute("src")).toBe(items[0].url);
		expect(img()?.getAttribute("alt")).toBe("a.png");
	});

	it("点「下一张」后 src 与 alt 都换成第二张", () => {
		mount();
		navButton("下一张")?.click();
		expect(img()?.getAttribute("src")).toBe(items[1].url);
		expect(img()?.getAttribute("alt")).toBe("b.png");
	});

	it("→ 键翻页、Esc 关闭", () => {
		const { onClose } = mount();
		document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
		expect(img()?.getAttribute("src")).toBe(items[1].url);

		document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("在第一张时「上一张」不可用（不会越界）", () => {
		mount();
		expect(navButton("上一张")?.disabled).toBe(true);
		expect(navButton("下一张")?.disabled).toBe(false);
	});
});

describe("ImageLightbox 缩放", () => {
	/**
	 * 让 <img> 有尺寸：jsdom 不做布局（offsetWidth 恒为 0，naturalWidth 也是 0），
	 * 而缩放是"以适应窗口的渲染尺寸为基准"的，所以这里把两个量都补上。
	 */
	function fakeLoadedImage(renderedWidth = 500, natural = 2000) {
		const el = img();
		if (!el) throw new Error("还没有 <img>");
		Object.defineProperty(el, "offsetWidth", {
			value: renderedWidth,
			configurable: true,
		});
		Object.defineProperty(el, "offsetHeight", {
			value: 400,
			configurable: true,
		});
		Object.defineProperty(el, "naturalWidth", {
			value: natural,
			configurable: true,
		});
		el.dispatchEvent(new Event("load"));
		return el;
	}

	const zoomValue = () =>
		document.querySelector<HTMLButtonElement>("[class*='zoomValue']");

	it("加载后按原始像素给百分比（大图适应窗口时远小于 100%）", () => {
		mount();
		fakeLoadedImage(500, 2000);
		// 500 / 2000 = 25%（这就是"适应窗口"的诚实读数）
		expect(zoomValue()?.textContent?.trim()).toBe("25%");
	});

	it("点放大：缩放倍数上去了，百分比跟着涨", async () => {
		mount();
		fakeLoadedImage(500, 2000);
		navButton("放大图片")?.click();
		await Promise.resolve();
		// 一档 ×1.25 → 500×1.25/2000 = 31%
		expect(zoomValue()?.textContent?.trim()).toBe("31%");
		// 显式像素宽度（缩放不能只靠 transform：那样滚动范围不会长出来）
		expect(img()?.style.width).toBe("625px");
	});

	it("双击在原图比例与适应窗口之间切换", async () => {
		mount();
		fakeLoadedImage(500, 2000);

		// 适应 → 1:1（2000/500 = 4 倍）→ 100%
		img()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		await Promise.resolve();
		expect(zoomValue()?.textContent?.trim()).toBe("100%");

		// 再双击回到适应
		img()?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
		await Promise.resolve();
		expect(zoomValue()?.textContent?.trim()).toBe("25%");
		expect(img()?.style.width).toBe("");
	});

	it("适应窗口时「缩小」不可用；放大后「回到适应」可点", async () => {
		mount();
		fakeLoadedImage(500, 2000);
		expect(navButton("缩小图片")?.disabled).toBe(true);
		expect(zoomValue()?.disabled).toBe(true);

		navButton("放大图片")?.click();
		await Promise.resolve();
		expect(navButton("缩小图片")?.disabled).toBe(false);
		expect(zoomValue()?.disabled).toBe(false);

		zoomValue()?.click();
		await Promise.resolve();
		expect(zoomValue()?.textContent?.trim()).toBe("25%");
	});

	it("翻页后回到适应窗口（每张图尺寸不同，保留上一张的倍率没意义）", async () => {
		mount();
		fakeLoadedImage(500, 2000);
		navButton("放大图片")?.click();
		await Promise.resolve();
		expect(zoomValue()?.textContent?.trim()).not.toBe("25%");

		navButton("下一张")?.click();
		await Promise.resolve();
		// 新图的 onLoad 还没跑（jsdom 不会真的加载），但倍率已复位 → 不再有显式宽度
		expect(img()?.style.width).toBe("");
	});

	it("滚轮缩放并阻止页面滚动", async () => {
		mount();
		fakeLoadedImage(500, 2000);

		const wheel = new WheelEvent("wheel", {
			deltaY: -100,
			bubbles: true,
			cancelable: true,
		});
		document
			.querySelector<HTMLElement>("[class*='overlay']")
			?.dispatchEvent(wheel);
		await Promise.resolve();
		// 放大了一档（且请求被 preventDefault 掉，不让底层页面跟着滚）
		expect(zoomValue()?.textContent?.trim()).toBe("31%");
		expect(wheel.defaultPrevented).toBe(true);
	});
});

describe("ImageLightbox 焦点管理（模态的礼貌）", () => {
	it("打开时把焦点收进对话框（否则 Tab 会跑到遮罩背后）", () => {
		mount();
		const close = document.querySelector<HTMLButtonElement>(
			"button[title='关闭（Esc）']",
		);
		expect(document.activeElement).toBe(close);
	});

	it("关闭时把焦点还给打开它的元素（键盘用户不必重新 Tab 找回来）", () => {
		// 模拟"从列表里的缩略图打开"：先聚焦它，再挂载灯箱
		const trigger = document.createElement("button");
		document.body.appendChild(trigger);
		trigger.focus();
		expect(document.activeElement).toBe(trigger);

		mount();
		// 焦点先被收进对话框
		expect(document.activeElement).not.toBe(trigger);

		// 关闭：组件先让父组件卸载，再把焦点还回触发元素
		document
			.querySelector<HTMLButtonElement>("button[title='关闭（Esc）']")
			?.click();
		expect(document.activeElement).toBe(trigger);

		// Esc 也走同一条路（键盘用户的常规操作）
		mount();
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(document.activeElement).toBe(trigger);
	});

	it("Tab 在对话框内回绕（末个 → 首个）", () => {
		mount();
		const close = document.querySelector<HTMLButtonElement>(
			"button[title='关闭（Esc）']",
		);
		close?.focus();
		const first = document.querySelector<HTMLElement>(
			"[class*='nav'][aria-label='上一张'], [class*='nav'][aria-label='下一张']",
		);
		first?.focus();

		const event = new KeyboardEvent("keydown", {
			key: "Tab",
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.dispatchEvent(event);
		// 从首个 Shift+Tab → 回绕到最后一个（关闭按钮）
		expect(document.activeElement).toBe(close);
	});
});
