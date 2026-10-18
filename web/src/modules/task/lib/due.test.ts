import { describe, expect, it } from "vite-plus/test";
import { formatDue } from "./due.ts";

describe("formatDue", () => {
	const now = new Date(2026, 9, 3, 12, 0);

	it("今天带钟点", () => {
		expect(formatDue(new Date(2026, 9, 3, 15, 5).toISOString(), now)).toEqual({
			text: "今天 15:05",
			overdue: false,
		});
	});

	it("逾期给天数与标记", () => {
		expect(formatDue(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toEqual({
			text: "逾期 2 天",
			overdue: true,
		});
	});

	it("一周内给剩余天数", () => {
		expect(formatDue(new Date(2026, 9, 5, 12, 0).toISOString(), now)).toEqual({
			text: "还剩 2 天",
			overdue: false,
		});
	});

	it("更远的给月-日", () => {
		expect(formatDue(new Date(2026, 9, 20, 9, 0).toISOString(), now)).toEqual({
			text: "10-20",
			overdue: false,
		});
	});

	it("无 due / 坏值 → null（不编一个日期出来）", () => {
		expect(formatDue(null, now)).toBeNull();
		expect(formatDue("xx", now)).toBeNull();
	});
});
