// ── TextContent：文本类查看器的外壳（取内容 + 加载中/失败提示） ──
// 钉住一条踩过的坑：**加载失败不能从 fetcher 抛错**——抛错会中断 Solid 的响应式更新，
// loading 永远停在 true，于是"加载中…"和错误提示会一直同时挂着。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextContent } from "./TextContent.tsx";
import { item } from "./test-fixtures.ts";

const flush = () => new Promise((r) => setTimeout(r, 0));
async function settle(check: () => boolean) {
	for (let i = 0; i < 50 && !check(); i++) await flush();
}

function mount(children: (text: string) => JSX.Element) {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(
		() => (
			<TextContent item={item({ mime_type: "text/plain" })}>
				{children}
			</TextContent>
		),
		host,
	);
	return host;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("TextContent", () => {
	it("拿到内容后交给子渲染函数", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("hello")),
		);
		const host = mount((text) => <p>正文：{text}</p>);

		await settle(() => (host.textContent ?? "").includes("正文"));
		expect(host.textContent).toContain("正文：hello");
		expect(host.textContent).not.toContain("加载中");
	});

	it("加载失败时只显示失败提示（不残留『加载中』，也不抛穿）", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 401 })),
		);
		const host = mount((text) => <p>正文：{text}</p>);

		await settle(() => (host.textContent ?? "").includes("预览失败"));
		expect(host.textContent).toContain("HTTP 401");
		expect(host.textContent).not.toContain("加载中");
		expect(host.textContent).not.toContain("正文");
	});

	it("超过 2MB 截断并给出提示", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("x".repeat(2 * 1024 * 1024 + 10))),
		);
		const host = mount((text) => <p>长度 {text.length}</p>);

		await settle(() => (host.textContent ?? "").includes("长度"));
		expect(host.textContent).toContain(`长度 ${2 * 1024 * 1024}`);
		expect(host.textContent).toContain("仅预览前 2MB");
	});
});
