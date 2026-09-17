// ── 文件头识别与十六进制排版（纯函数直测） ──

import { describe, expect, it } from "vitest";
import { hexRows, looksTextual, sniffKind } from "./magic.ts";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("sniffKind", () => {
	const cases: Array<[string, Uint8Array, string]> = [
		["空文件", bytes(), "空文件"],
		[
			"zip 容器（docx/epub 同签名）",
			bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00),
			"ZIP 容器（zip / docx / xlsx / epub / jar 都是它）",
		],
		["pdf", bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31), "PDF"],
		["png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), "PNG 图片"],
		["psd", bytes(0x38, 0x42, 0x50, 0x53, 0x00, 0x01), "Photoshop 文档（PSD）"],
		[
			"sqlite",
			bytes(..."SQLite format 3\0".split("").map((c) => c.charCodeAt(0))),
			"SQLite 数据库",
		],
		[
			"纯文本（无签名）",
			bytes(..."hello world".split("").map((c) => c.charCodeAt(0))),
			"文本（没有已知的二进制签名）",
		],
		[
			"未识别二进制",
			bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05),
			"未识别的二进制格式",
		],
	];

	for (const [name, input, expected] of cases) {
		it(`${name} → ${expected}`, () => {
			expect(sniffKind(input)).toBe(expected);
		});
	}

	it("签名比内容长时不误判", () => {
		// "PK" 只是 zip 签名的前两字节
		expect(sniffKind(bytes(0x50, 0x4b))).not.toContain("ZIP");
	});
});

describe("looksTextual", () => {
	it("ASCII 可见字符与换行算文本", () => {
		expect(
			looksTextual(bytes(..."a\r\nb".split("").map((c) => c.charCodeAt(0)))),
		).toBe(true);
	});

	it("含大量控制字节时不算文本", () => {
		expect(looksTextual(bytes(0x00, 0x01, 0x02, 0x03, 0x04, 0x05))).toBe(false);
	});

	it("空内容不算文本", () => {
		expect(looksTextual(bytes())).toBe(false);
	});
});

describe("hexRows", () => {
	it("每行 16 字节，偏移按 8 位十六进制", () => {
		const rows = hexRows(new Uint8Array(20).fill(0x41));
		expect(rows.length).toBe(2);
		expect(rows[0].offset).toBe("00000000");
		expect(rows[1].offset).toBe("00000010");
	});

	it("ASCII 列把不可打印字节显示为点", () => {
		const rows = hexRows(bytes(0x50, 0x4b, 0x00, 0x41));
		expect(rows[0].hex.startsWith("50 4b 00 41")).toBe(true);
		expect(rows[0].ascii).toBe("PK.A");
	});

	it("末行补齐到固定宽度（保证 ASCII 列对齐）", () => {
		const rows = hexRows(bytes(0x41, 0x42));
		expect(rows[0].hex.length).toBe(16 * 3 - 1);
		expect(rows[0].ascii).toBe("AB");
	});

	it("空内容没有行", () => {
		expect(hexRows(bytes()).length).toBe(0);
	});

	it("baseOffset 接着文件真实位置往下数（分段预览的后续段）", () => {
		// 十六进制查看器按 4KB 分段取内容；第二段的左侧偏移量必须接下去，
		// 否则每段都从 00000000 开始，看着像同一个位置
		const rows = hexRows(new Uint8Array(20).fill(0x41), 0x1000);
		expect(rows[0].offset).toBe("00001000");
		expect(rows[1].offset).toBe("00001010");
	});
});
