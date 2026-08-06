import { describe, expect, it } from "vitest";
import { boolParam, enumParam, listParam, numParam, strParam } from "./useUrlParams";

describe("strParam", () => {
	it("reads missing as default", () => {
		expect(strParam("").read(undefined)).toBe("");
		expect(strParam("d").read(undefined)).toBe("d");
	});

	it("reads raw string", () => {
		expect(strParam("").read("hello")).toBe("hello");
	});

	it("omits default on write", () => {
		expect(strParam("").write("")).toBeUndefined();
		expect(strParam("d").write("d")).toBeUndefined();
		expect(strParam("").write("x")).toBe("x");
	});
});

describe("numParam", () => {
	it("parses valid numbers", () => {
		expect(numParam(1).read("3")).toBe(3);
		expect(numParam(0).read("0")).toBe(0);
	});

	it("falls back on invalid input", () => {
		expect(numParam(1).read(undefined)).toBe(1);
		expect(numParam(1).read("abc")).toBe(1);
		expect(numParam(1).read("")).toBe(1);
		expect(numParam(1).read("1.5")).toBe(1); // 非整数
		expect(numParam(1).read("-1")).toBe(1); // 负数
	});

	it("respects min option", () => {
		const p = numParam(1, { min: 1 });
		expect(p.read("0")).toBe(1);
		expect(p.read("5")).toBe(5);
	});

	it("allows non-integer when requested", () => {
		expect(numParam(0, { integer: false }).read("2.5")).toBe(2.5);
	});

	it("omits default on write", () => {
		expect(numParam(1).write(1)).toBeUndefined();
		expect(numParam(1).write(7)).toBe("7");
	});
});

describe("listParam", () => {
	it("splits and filters empty segments", () => {
		expect(listParam().read("a,b,c")).toEqual(["a", "b", "c"]);
		expect(listParam().read("a,,b,")).toEqual(["a", "b"]);
		expect(listParam().read(undefined)).toEqual([]);
		expect(listParam().read("")).toEqual([]);
	});

	it("joins on write, empty list omitted", () => {
		expect(listParam().write(["a", "b"])).toBe("a,b");
		expect(listParam().write([])).toBeUndefined();
	});

	it("supports custom separator", () => {
		expect(listParam("|").read("x|y")).toEqual(["x", "y"]);
	});
});

describe("enumParam", () => {
	const valid = ["list", "kanban"] as const;

	it("accepts whitelisted values", () => {
		expect(enumParam(valid, "list").read("kanban")).toBe("kanban");
		expect(enumParam(valid, "list").read("list")).toBe("list");
	});

	it("falls back on unknown or missing", () => {
		expect(enumParam(valid, "list").read("table")).toBe("list");
		expect(enumParam(valid, "list").read(undefined)).toBe("list");
	});

	it("omits default on write", () => {
		expect(enumParam(valid, "list").write("list")).toBeUndefined();
		expect(enumParam(valid, "list").write("kanban")).toBe("kanban");
	});
});

describe("boolParam", () => {
	it("parses truthy/falsy forms", () => {
		expect(boolParam().read("1")).toBe(true);
		expect(boolParam().read("true")).toBe(true);
		expect(boolParam().read("0")).toBe(false);
		expect(boolParam().read("false")).toBe(false);
	});

	it("falls back on garbage", () => {
		expect(boolParam().read("yes")).toBe(false);
		expect(boolParam(true).read(undefined)).toBe(true);
	});

	it("round-trips write", () => {
		expect(boolParam().write(true)).toBe("1");
		expect(boolParam().write(false)).toBeUndefined();
		expect(boolParam(true).write(true)).toBeUndefined();
		expect(boolParam(true).write(false)).toBe("0");
	});
});
