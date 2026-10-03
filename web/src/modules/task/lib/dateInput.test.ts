import { describe, expect, it } from "vitest";
import { DEFAULT_HOUR, formatDateInput, parseDateInput } from "./dateInput.ts";

describe("parseDateInput", () => {
	it("收 - / . 空格 四种分隔符", () => {
		for (const text of [
			"2026-10-03",
			"2026/10/03",
			"2026.10.03",
			"2026 10 03",
		]) {
			const date = parseDateInput(text);
			expect(date, text).not.toBeNull();
			expect(formatDateInput(date as Date)).toBe(
				`2026-10-03 0${DEFAULT_HOUR}:00`,
			);
		}
	});

	it("不强制补零（`2026/10/3` 合法）", () => {
		expect(formatDateInput(parseDateInput("2026/10/3") as Date)).toBe(
			`2026-10-03 0${DEFAULT_HOUR}:00`,
		);
	});

	it("只给月/日按今年算", () => {
		const date = parseDateInput("10/3") as Date;
		expect(date.getFullYear()).toBe(new Date().getFullYear());
		expect(date.getMonth()).toBe(9);
		expect(date.getDate()).toBe(3);
	});

	it("带时间：空格与 T 都认，可带秒", () => {
		expect(formatDateInput(parseDateInput("2026-10-03 15:30") as Date)).toBe(
			"2026-10-03 15:30",
		);
		expect(formatDateInput(parseDateInput("2026-10-03T15:30") as Date)).toBe(
			"2026-10-03 15:30",
		);
		expect(formatDateInput(parseDateInput("2026-10-03 15:30:45") as Date)).toBe(
			"2026-10-03 15:30",
		);
	});

	it("空串 = 没填（清空走这里，不报错）", () => {
		expect(parseDateInput("")).toBeNull();
		expect(parseDateInput("   ")).toBeNull();
	});

	it("不存在的日期不认（`2026-02-31` 会被 Date 悄悄挪成 3 月）", () => {
		expect(parseDateInput("2026-02-31")).toBeNull();
		expect(parseDateInput("2026-13-01")).toBeNull();
		expect(parseDateInput("2026-10-32")).toBeNull();
	});

	it("非法时间不认", () => {
		expect(parseDateInput("2026-10-03 25:00")).toBeNull();
		expect(parseDateInput("2026-10-03 10:70")).toBeNull();
	});

	it("认不出来的整串不认（不猜）", () => {
		expect(parseDateInput("下周一")).toBeNull();
		expect(parseDateInput("abc")).toBeNull();
		expect(parseDateInput("2026-10")).toBeNull();
		expect(parseDateInput("2026-10-03 一会儿")).toBeNull();
	});
});

describe("formatDateInput", () => {
	it("补零成 2026-10-03 09:05", () => {
		expect(formatDateInput(new Date(2026, 9, 3, 9, 5))).toBe(
			"2026-10-03 09:05",
		);
	});

	it("与解析互逆", () => {
		const text = "2026-10-03 15:30";
		expect(formatDateInput(parseDateInput(text) as Date)).toBe(text);
	});
});
