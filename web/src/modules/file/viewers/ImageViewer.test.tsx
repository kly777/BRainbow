// ── ImageViewer：<img> 加载失败要有交代，不能只剩一个破图图标 ──
// 起因：image/tiff 这类"归 image 类别但浏览器渲染不了"的格式原先只是破图。
//
// 另钉住一条产品决定：详情页的灯箱只放大**当前这张**，不提供跨文件翻页
// （详情页是文件汇集里的一条，相邻文件无语义关系；要翻一组图请走列表页）。

import { render } from "solid-js/web";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageViewer } from "./ImageViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<ImageViewer
				item={item({ mime_type: "image/tiff", original_name: "扫描件.tiff" })}
			/>
		),
		host,
	);
	return host;
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("ImageViewer", () => {
	it("图片加载出错时改渲染下载面板，并说清是格式不支持", async () => {
		const host = mount();
		await settle(() => host.querySelector("img") !== null);

		host.querySelector("img")?.dispatchEvent(new Event("error"));
		await settle(() => host.querySelector("img") === null);

		expect(host.querySelector("img")).toBeNull();
		expect(host.textContent).toContain("扫描件.tiff");
		expect(host.textContent).toContain("浏览器无法预览");
		expect(host.textContent).toContain("下载");
	});

	it("点图片打开灯箱（不再跳新窗口），只有当前这一张、没有翻页", async () => {
		const host = mount();
		await settle(() => host.querySelector("img") !== null);

		// 换代前的"点开新窗口"已去掉：改成站内灯箱
		expect(host.querySelector("a[target=_blank]")).toBeNull();

		host
			.querySelector("button[title='放大查看']")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		await settle(() => document.body.textContent?.includes("1 / 1") ?? false);
		expect(document.body.textContent).toContain("1 / 1");
		// 灯箱是 Portal 到 body 的遮罩（role=dialog）；单张时不出现翻页按钮
		expect(document.querySelector("[role=dialog]")).not.toBeNull();
		expect(document.querySelector("button[aria-label='上一张']")).toBeNull();
		expect(document.querySelector("button[aria-label='下一张']")).toBeNull();
	});
});
