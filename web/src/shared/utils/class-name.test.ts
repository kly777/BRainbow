import { describe, expect, it } from "vitest";
import { joinClass } from "./class-name.ts";

describe("joinClass", () => {
	it("按传入顺序拼接，单个空格分隔", () => {
		expect(joinClass("a", "b")).toBe("a b");
	});

	it("丢掉 false / undefined / 空串（条件类名可直接写表达式）", () => {
		expect(joinClass("a", false, undefined, "", "b")).toBe("a b");
	});

	it("全空时返回空串", () => {
		expect(joinClass(false, undefined, "")).toBe("");
		expect(joinClass()).toBe("");
	});
});
