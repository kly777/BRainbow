// ── 类型底色（纯函数直测） ──
//
// 这里锁两条：**同一类型永远同色**（否则每次刷新都变色，颜色就不再是线索），
// 以及**同族相近、跨族分开**（PDF 与 xlsx 不该像同一个东西）。

import { describe, expect, it } from "vitest";
import type { FileItem } from "../api.ts";
import { shouldTint, tintHue } from "./thumbTint.ts";

const pick = (
	original_name: string,
	over: Partial<Pick<FileItem, "file_category" | "missing">> = {},
) => ({
	original_name,
	file_category: "other" as const,
	missing: false,
	...over,
});

describe("tintHue", () => {
	it("同一后缀永远同一个色相", () => {
		expect(tintHue(pick("报告.pdf"))).toBe(tintHue(pick("另一个.PDF")));
		expect(tintHue(pick("a.zip"))).toBe(tintHue(pick("b.zip")));
	});

	it("同族同色、跨族分开", () => {
		const pdf = tintHue(pick("a.pdf"));
		expect(tintHue(pick("b.docx"))).toBe(pdf);
		expect(tintHue(pick("c.xlsx"))).not.toBe(pdf);
		expect(tintHue(pick("d.mp4"))).not.toBe(pdf);
	});

	it("未收录的后缀也能得到一个稳定值", () => {
		const first = tintHue(pick("mystery.xyzzy"));
		expect(first).toBeGreaterThanOrEqual(0);
		expect(first).toBeLessThan(360);
		expect(tintHue(pick("other.xyzzy"))).toBe(first);
	});

	it("无后缀的文件按类别偏色", () => {
		expect(tintHue(pick("LICENSE", { file_category: "document" }))).toBe(262);
		expect(tintHue(pick("LICENSE", { file_category: "video" }))).toBe(355);
		// 隐藏文件（.bashrc）没有后缀，走的也是类别兜底
		expect(tintHue(pick(".bashrc", { file_category: "document" }))).toBe(262);
	});
});

describe("shouldTint", () => {
	it("非图片文件着色", () => {
		expect(shouldTint(pick("a.pdf", { file_category: "document" }))).toBe(true);
		expect(shouldTint(pick("a.mp4", { file_category: "video" }))).toBe(true);
	});

	it("图片不着色（它有真缩略图）", () => {
		expect(shouldTint(pick("a.png", { file_category: "image" }))).toBe(false);
	});

	it("缺失文件不着色（彩色底会显得「还有东西」）", () => {
		expect(
			shouldTint(pick("a.pdf", { file_category: "document", missing: true })),
		).toBe(false);
	});
});
