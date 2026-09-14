// ── ImageViewer：<img> 加载失败要有交代，不能只剩一个破图图标 ──
// 起因：image/tiff 这类"归 image 类别但浏览器渲染不了"的格式原先只是破图。

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
});
