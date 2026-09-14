// ── HexViewer：other 类别的二进制文件至少能看清是什么 ──

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HexViewer } from "./HexViewer.tsx";
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
			<HexViewer
				item={item({
					file_category: "other",
					mime_type: "application/zip",
					original_name: "备份.zip",
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

describe("HexViewer", () => {
	it("拉取内容后给出文件头结论与十六进制行", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(
						// ZIP 文件头：PK\x03\x04
						new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
					),
			),
		);
		const host = mount();

		await settle(() => (host.textContent ?? "").includes("文件头"));
		expect(host.textContent).toContain("ZIP 容器");
		expect(host.textContent).toContain("50 4b 03 04");
		expect(host.textContent).toContain("PK");
	});

	it("超过下载上限的文件不拉取内容，改给下载入口", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const host = mount({ size_bytes: 50 * 1024 * 1024 });

		await settle(() => (host.textContent ?? "").includes("下载"));
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(host.textContent).toContain("文件超过 2MB");
		expect(host.textContent).toContain("备份.zip");
	});
});
