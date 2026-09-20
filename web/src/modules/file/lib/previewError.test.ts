// ── 预览失败分类：决定"重试有没有意义" ──
//
// 分界线是"换个时刻再试会不会不一样"：网络/5xx 会，4xx 不会（内容问题、权限、丢了）。
// 这条判断直接决定用户看到「重试」还是只有「下载」，错分的代价是让人白点或没有出路。

import { describe, expect, it } from "vitest";
import { httpPreviewError, networkPreviewError } from "./previewError.ts";

describe("httpPreviewError", () => {
	it("400 用后端给的原因，且不给重试（内容问题，重试还是同样结果）", () => {
		const e = httpPreviewError(400, "文件超过 32MB，不在服务端解析预览");
		expect(e.message).toBe("文件超过 32MB，不在服务端解析预览");
		expect(e.retryable).toBe(false);
		expect(e.hint).toContain("下载");
	});

	it("400 没有后端原因时给一句可读的兜底", () => {
		expect(httpPreviewError(400).message).toBe("这个文件无法解析预览");
	});

	it("401 / 403 说权限，不给重试", () => {
		for (const status of [401, 403]) {
			expect(httpPreviewError(status).retryable).toBe(false);
			expect(httpPreviewError(status).message).toContain("权限");
		}
	});

	it("404 说明内容丢失（数据库还有记录）", () => {
		const e = httpPreviewError(404);
		expect(e.retryable).toBe(false);
		expect(e.message).toContain("丢失");
		expect(e.hint).toContain("磁盘");
	});

	it("429 / 5xx 可重试", () => {
		for (const status of [429, 500, 502, 503]) {
			const e = httpPreviewError(status);
			expect(e.retryable, `HTTP ${status}`).toBe(true);
			expect(e.message).toContain(String(status));
		}
	});

	it("其余 4xx（如 416 分段越界）不重试，但有下载出口", () => {
		const e = httpPreviewError(416);
		expect(e.retryable).toBe(false);
		expect(e.hint).toContain("下载");
	});
});

describe("networkPreviewError", () => {
	it("网络错误可重试，并提示检查网络", () => {
		const e = networkPreviewError();
		expect(e.retryable).toBe(true);
		expect(e.hint).toContain("网络");
	});
});
