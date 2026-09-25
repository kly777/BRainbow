import { describe, expect, it } from "vitest";
import { knownLevel, knownPercent } from "./reading-stats.ts";

describe("knownLevel", () => {
	it("≥80% 是 high（含边界）", () => {
		expect(knownLevel(0.8)).toBe("high");
		expect(knownLevel(1)).toBe("high");
	});

	it("50%–80% 是 mid（含下界）", () => {
		expect(knownLevel(0.5)).toBe("mid");
		expect(knownLevel(0.79)).toBe("mid");
	});

	it("<50% 是 low", () => {
		expect(knownLevel(0.49)).toBe("low");
		expect(knownLevel(0)).toBe("low");
	});
});

describe("knownPercent", () => {
	it("四舍五入到整数（文案与进度条宽度共用）", () => {
		expect(knownPercent(0.856)).toBe("86");
		expect(knownPercent(0.8)).toBe("80");
		expect(knownPercent(0.844)).toBe("84");
	});

	it("0 与 1 是两端", () => {
		expect(knownPercent(0)).toBe("0");
		expect(knownPercent(1)).toBe("100");
	});
});
