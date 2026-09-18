// ── TextContent：文本类查看器的外壳（取内容 + 加载中/失败提示） ──
// 钉住一条踩过的坑：**加载失败不能从 fetcher 抛错**——抛错会中断 Solid 的响应式更新，
// loading 永远停在 true，于是"加载中…"和错误提示会一直同时挂着。

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PREVIEW_BYTES } from "../hooks/usePreviewText.ts";
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

		await settle(() => (host.textContent ?? "").includes("没有权限"));
		expect(host.textContent).toContain("没有权限查看这个文件");
		expect(host.textContent).not.toContain("加载中");
		expect(host.textContent).not.toContain("正文");
	});

	it("可重试的失败给「重试」，点了会重新请求（4xx 不给重试）", async () => {
		const fetchSpy = vi.fn(async () => new Response("boom", { status: 503 }));
		vi.stubGlobal("fetch", fetchSpy);
		const host = mount((text) => <p>正文：{text}</p>);

		await settle(() => (host.textContent ?? "").includes("服务暂时不可用"));
		const retry = Array.from(host.querySelectorAll("button")).find((b) =>
			(b.textContent ?? "").includes("重试"),
		);
		expect(retry).toBeDefined();
		// 预览失败不代表文件没用：下载入口始终在
		expect(host.textContent).toContain("下载");

		fetchSpy.mockResolvedValue(new Response("hello"));
		retry?.click();
		await settle(() => (host.textContent ?? "").includes("正文：hello"));
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it("4xx（内容问题）不给重试按钮，只给下载", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("nope", { status: 400 })),
		);
		const host = mount((text) => <p>正文：{text}</p>);

		await settle(() => (host.textContent ?? "").includes("无法解析预览"));
		const buttons = Array.from(host.querySelectorAll("button")).map(
			(b) => b.textContent ?? "",
		);
		expect(buttons.some((t) => t.includes("重试"))).toBe(false);
		expect(buttons.some((t) => t.includes("下载"))).toBe(true);
	});

	it("按 Range 取头部：满一段（206）就提示只预览了前 4MB", async () => {
		// 服务端按 Range 回满一段 = 后面还有内容 → 截断提示。
		// 早先是"整包下载后按字符截断"（见 hooks/usePreviewText.ts 的文件头注释）
		const segment = "x".repeat(MAX_PREVIEW_BYTES);
		vi.stubGlobal(
			"fetch",
			vi.fn(
				async () =>
					new Response(segment, {
						status: 206,
						headers: {
							"content-range": `bytes 0-${MAX_PREVIEW_BYTES - 1}/${MAX_PREVIEW_BYTES * 3}`,
						},
					}),
			),
		);
		const host = mount((text) => <p>长度 {text.length}</p>);

		await settle(() => (host.textContent ?? "").includes("长度"));
		expect(host.textContent).toContain(`长度 ${MAX_PREVIEW_BYTES}`);
		expect(host.textContent).toContain("仅预览前 4MB");
	});

	it("文件比一段小（200 整包）时不提示截断", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response("hello")),
		);
		const host = mount((text) => <p>长度 {text.length}</p>);

		await settle(() => (host.textContent ?? "").includes("长度"));
		expect(host.textContent).toContain("长度 5");
		expect(host.textContent).not.toContain("仅预览前");
	});
});
