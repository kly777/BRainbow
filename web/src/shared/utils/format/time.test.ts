import { describe, expect, it, vi } from "vitest";
import {
	fmtHm,
	fmtInterval,
	fmtRelative,
	nowIsoUtc,
	parseUtc,
} from "./time.ts";

describe("parseUtc", () => {
	function ymd(d: Date): string {
		return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
	}

	it("parses ISO string with Z", () => {
		const d = parseUtc("2026-07-06T10:00:00Z");
		expect(ymd(d)).toBe("2026-07-06");
		expect(d.getUTCHours()).toBe(10);
	});

	it("parses ISO string without Z", () => {
		const d = parseUtc("2026-07-06T10:00:00");
		expect(ymd(d)).toBe("2026-07-06");
		expect(d.getUTCHours()).toBe(10);
	});

	it("parses with timezone offset", () => {
		const d = parseUtc("2026-07-06T18:00:00+08:00");
		// 18:00 +08:00 = 10:00 UTC
		expect(ymd(d)).toBe("2026-07-06");
		expect(d.getUTCHours()).toBe(10);
	});

	it("parses negative offset", () => {
		const d = parseUtc("2026-07-06T05:00:00-05:00");
		// 05:00 -05:00 = 10:00 UTC
		expect(d.getUTCHours()).toBe(10);
	});

	it("handles edge date: 2026-01-01T00:00:00Z", () => {
		const d = parseUtc("2026-01-01T00:00:00Z");
		expect(ymd(d)).toBe("2026-01-01");
		expect(d.getUTCHours()).toBe(0);
	});
});

describe("fmtRelative", () => {
	// Helper: returns a UTC ISO string that is `secs` in the future
	function future(secs: number): string {
		return new Date(Date.now() + secs * 1000).toISOString();
	}

	function past(secs: number): string {
		return new Date(Date.now() - secs * 1000).toISOString();
	}

	it('returns "待复习" for past dates', () => {
		expect(fmtRelative(past(60))).toBe("待复习");
	});

	it('returns "1分钟" for < 2 min', () => {
		expect(fmtRelative(future(30))).toBe("1分钟");
		expect(fmtRelative(future(90))).toBe("1分钟");
	});

	it("returns X分钟 for < 1 hour", () => {
		const result = fmtRelative(future(600)); // 10 min
		expect(result).toBe("10分钟");
	});

	it("returns X小时 for < 1 day", () => {
		const result = fmtRelative(future(7200)); // 2 hours
		expect(result).toBe("2小时");
	});

	it("returns X天后 for >= 1 day", () => {
		const result = fmtRelative(future(172800)); // 2 days
		expect(result).toBe("2天后");
	});

	it("returns X天后 for 7 days", () => {
		const result = fmtRelative(future(604800));
		expect(result).toBe("7天后");
	});

	it("handles exactly 0 seconds (now = just happened)", () => {
		// ISO 字符串只有秒级精度，把“现在”对齐到整秒并固定 Date.now，
		// 避免调用间隙跨过毫秒边界导致 diff 恰好为负的偶发失败。
		const now = Math.ceil(Date.now() / 1000) * 1000;
		vi.spyOn(Date, "now").mockReturnValue(now);
		expect(fmtRelative(new Date(now).toISOString())).toBe("1分钟");
		vi.restoreAllMocks();
	});
});

describe("fmtInterval", () => {
	it('returns "1分钟" for < 120s', () => {
		expect(fmtInterval(0)).toBe("1分钟");
		expect(fmtInterval(60)).toBe("1分钟");
		expect(fmtInterval(119)).toBe("1分钟");
	});

	it("returns X分钟 for < 3600s", () => {
		expect(fmtInterval(600)).toBe("10分钟");
		expect(fmtInterval(3540)).toBe("59分钟");
	});

	it("returns X小时 for < 86400s", () => {
		expect(fmtInterval(3600)).toBe("1小时");
		expect(fmtInterval(7200)).toBe("2小时");
		expect(fmtInterval(86399)).toBe("24小时");
	});

	it("returns X天 for < 2592000s", () => {
		expect(fmtInterval(86400)).toBe("1天");
		expect(fmtInterval(604800)).toBe("7天");
		expect(fmtInterval(2591999)).toBe("30天");
	});

	it("returns X个月 for >= 2592000s", () => {
		expect(fmtInterval(2592000)).toBe("1个月");
		expect(fmtInterval(5184000)).toBe("2个月");
		expect(fmtInterval(31536000)).toBe("12个月");
	});
});

describe("nowIsoUtc", () => {
	it("matches backend storage format (T separator, +00:00 offset)", () => {
		const now = nowIsoUtc();
		expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
		// 与真实 UTC 一致（允许秒级进位）
		const parsed = Date.parse(now);
		expect(Math.abs(parsed - Date.now())).toBeLessThan(2000);
	});
});

describe("fmtHm", () => {
	it("按本地时刻输出 MM 位补零的 HH:MM", () => {
		// 用本地时区构造，避免断言依赖运行环境的时区
		const local = new Date(2026, 6, 6, 9, 5);
		expect(fmtHm(local.toISOString())).toBe("09:05");
	});

	it("无法解析的时间给空串（而不是 Invalid Date 之类的字面量）", () => {
		expect(fmtHm("")).toBe("");
	});
});
