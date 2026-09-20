// ── HexViewer：other 类别的二进制文件至少能看清是什么 ──
//
// 内容按 Range 分段取：这里钉住两件事 —— ① 第一段给"文件头"结论；
// ② 翻页取的是**下一段的偏移**（不再有"超过 2MB 就不给看"的闸门）。

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

/** 按 Range 头的起点回一段固定内容，并报告文件总长 */
function stubRangedFetch(totalBytes: number) {
	const calls: string[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (_url: string, init?: RequestInit) => {
			const range = new Headers(init?.headers).get("range") ?? "";
			calls.push(range);
			const start =
				Number.parseInt(range.replace(/\D+(\d+)-.*/, "$1"), 10) || 0;
			const last = Number.parseInt(range.slice(range.indexOf("-") + 1), 10);
			const length = Math.min(last - start + 1, totalBytes - start);
			return new Response(new Uint8Array(Math.max(0, length)).fill(0x41), {
				status: 206,
				headers: {
					"content-range": `bytes ${start}-${start + length - 1}/${totalBytes}`,
				},
			});
		}),
	);
	return calls;
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

	it("大文件照样能看（不再有 2MB 闸门），并按偏移翻页", async () => {
		const total = 50 * 1024 * 1024;
		const calls = stubRangedFetch(total);
		const host = mount({ size_bytes: total });

		await settle(() => (host.textContent ?? "").includes("文件头"));
		expect(calls[0]).toBe("bytes=0-4095");

		// 第一段：没有"上一段"，给了总大小
		const buttons = () =>
			Array.from(host.querySelectorAll("button")).map((b) => ({
				text: b.textContent ?? "",
				disabled: b.disabled,
			}));
		expect(buttons().find((b) => b.text.includes("上一段"))?.disabled).toBe(
			true,
		);
		expect(host.textContent).toContain("50.0 MB");

		// 下一段：取 4096 起的新一段，左侧偏移量跟着文件位置走
		const next = Array.from(host.querySelectorAll("button")).find((b) =>
			(b.textContent ?? "").includes("下一段"),
		);
		next?.click();
		await settle(() => calls.length > 1);
		expect(calls[1]).toBe("bytes=4096-8191");
		// 等第二段真正渲染出来：分页标签的范围是"00001000–00002000"
		await settle(() => (host.textContent ?? "").includes("00001000–00002000"));
		expect(host.textContent).toContain("00001000–00002000");
		expect(
			buttons().find((b) => b.text.includes("上一段")),
			`buttons=${JSON.stringify(buttons())}`,
		).toMatchObject({ disabled: false });
	});
});
