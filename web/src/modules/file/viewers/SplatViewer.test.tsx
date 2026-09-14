// ── SplatViewer 的降级路径 ──
// jsdom 没有 WebGL2，正好用来钉住"渲染不了时给提示而不是白屏"这条契约；
// 超大文件则完全不下载、只给下载入口。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplatViewer } from "./SplatViewer.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount(over = {}) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<SplatViewer
				item={item({
					original_name: "场景.ply",
					mime_type: "application/octet-stream",
					file_category: "other",
					...over,
				})}
			/>
		),
		host,
	);
	return host;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("SplatViewer", () => {
	it("没有 WebGL2 时给出提示与下载路径，而不是白屏", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(new Uint8Array(1024).fill(1), {
						status: 206,
						headers: { "content-range": "bytes 0-1023/1024" },
					}),
			),
		);
		const host = mount();

		await settle(() => (host.textContent ?? "").includes("3D 预览"));
		expect(host.textContent).toContain("3D 预览不可用");
		expect(host.textContent).toContain("WebGL2");
		expect(host.querySelector("canvas")).toBeTruthy();
	});

	it("超过上限的文件不下载，直接给下载入口", async () => {
		const fetchSpy = vi.fn(
			async () =>
				new Response(new Uint8Array(1024), {
					status: 206,
					headers: { "content-range": `bytes 0-1023/${512 * 1024 * 1024}` },
				}),
		);
		vi.stubGlobal("fetch", fetchSpy);
		const host = mount();

		await settle(() => (host.textContent ?? "").includes("下载"));
		expect(host.textContent).toContain("文件超过 256 MB");
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(host.querySelector("canvas")).toBeNull();
	});
});
