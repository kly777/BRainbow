// ── 字节格式化：两种口径 ──
// compact 口径原先是 file/lib/uploadLimits.ts 里的一份同名局部实现（口径相同、
// 名字相同、语义不同），统一到这里之后，这里的两组断言就是两条口径的契约。

import { describe, expect, it } from "vitest";
import { formatBytes } from "./bytes.ts";

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

describe("formatBytes（默认口径：KB/MB 一位、GB 两位）", () => {
	it("小于 1KB 报字节", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1023)).toBe("1023 B");
	});

	it("KB / MB / GB 各按各的位数", () => {
		expect(formatBytes(1024)).toBe("1.0 KB");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(MIB)).toBe("1.0 MB");
		expect(formatBytes(GIB)).toBe("1.00 GB");
		expect(formatBytes(1.5 * GIB)).toBe("1.50 GB");
	});
});

describe("formatBytes（compact 口径：整数不带小数）", () => {
	it("整数报整数，非整数一位小数", () => {
		expect(formatBytes(0, { compact: true })).toBe("0 B");
		expect(formatBytes(512, { compact: true })).toBe("512 B");
		expect(formatBytes(1024, { compact: true })).toBe("1 KB");
		expect(formatBytes(1536, { compact: true })).toBe("1.5 KB");
	});

	it("档位上限读起来是「上限 200 MB」而不是「200.0 MB」", () => {
		expect(formatBytes(200 * MIB, { compact: true })).toBe("200 MB");
		expect(formatBytes(GIB, { compact: true })).toBe("1 GB");
		expect(formatBytes(4 * GIB, { compact: true })).toBe("4 GB");
		expect(formatBytes(1.5 * GIB, { compact: true })).toBe("1.5 GB");
	});
});
