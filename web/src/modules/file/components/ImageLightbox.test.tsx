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
