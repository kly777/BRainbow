// ── 文件元信息格式化：时长与像素尺寸 ──

import { describe, expect, it } from "vitest";
import { fmtDimensions, fmtDuration, fmtDurationMs } from "./meta.ts";

describe("fmtDuration", () => {
	it("不足一分钟补零到 0:ss", () => {
		expect(fmtDuration(3_000)).toBe("0:03");
	});

	it("分钟级为 m:ss", () => {
		expect(fmtDuration(125_000)).toBe("2:05");
	});

	it("小时级为 h:mm:ss", () => {
		expect(fmtDuration(3_725_000)).toBe("1:02:05");
	});
});

describe("fmtDurationMs", () => {
	it("空值 / 0 / 负数返回 null", () => {
		expect(fmtDurationMs(null)).toBeNull();
		expect(fmtDurationMs(undefined)).toBeNull();
		expect(fmtDurationMs(0)).toBeNull();
		expect(fmtDurationMs(-1)).toBeNull();
	});

	it("有效时长转成 m:ss", () => {
		expect(fmtDurationMs(65_000)).toBe("1:05");
	});
});

describe("fmtDimensions", () => {
	it("宽高齐全时输出 宽 × 高", () => {
		expect(fmtDimensions(1920, 1080)).toBe("1920 × 1080");
	});

	it("缺任一项或为 0 时返回 null", () => {
		expect(fmtDimensions(null, 1080)).toBeNull();
		expect(fmtDimensions(1920, null)).toBeNull();
		expect(fmtDimensions(0, 0)).toBeNull();
		expect(fmtDimensions(undefined, undefined)).toBeNull();
	});
});
