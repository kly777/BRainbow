import { afterEach, describe, expect, it, vi } from "vitest";
import { streamChatRequest } from "./streamChatRequest.ts";

function sseResponse(...chunks: string[]): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { "Content-Type": "text/event-stream" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("streamChatRequest", () => {
	it("累积回调增量并在收到 __DONE__ 时成功", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					sseResponse(
						"data: hello\n\n",
						"data:  world\n\n",
						"data: __DONE__\n\n",
					),
				),
		);
		const onPatch = vi.fn();

		const result = await streamChatRequest(
			1,
			null,
			"hi",
			"token",
			new AbortController().signal,
			onPatch,
		);

		expect(result).toEqual({ ok: true, error: "" });
		expect(onPatch).toHaveBeenLastCalledWith("hello world", "");
	});

	it("未收到 __DONE__ 就断流时返回失败而不是成功", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(sseResponse("data: partial\n\n")),
		);
		const onPatch = vi.fn();

		const result = await streamChatRequest(
			1,
			null,
			"hi",
			"token",
			new AbortController().signal,
			onPatch,
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("中断");
		expect(onPatch).toHaveBeenLastCalledWith("partial", "");
	});

	it("收到 __ERROR__ 前缀时透传错误文案", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(sseResponse("data: __ERROR__:模型超时\n\n")),
		);

		const result = await streamChatRequest(
			1,
			null,
			"hi",
			"token",
			new AbortController().signal,
			vi.fn(),
		);

		expect(result).toEqual({ ok: false, error: "模型超时" });
	});

	it("非 2xx 响应直接失败", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
		);

		const result = await streamChatRequest(
			1,
			null,
			"hi",
			"token",
			new AbortController().signal,
			vi.fn(),
		);

		expect(result.ok).toBe(false);
		expect(result.error).toContain("401");
	});
});
