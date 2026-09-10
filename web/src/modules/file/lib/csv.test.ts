import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv.ts";

describe("parseCsv", () => {
	it("解析基本逗号分隔行", () => {
		expect(parseCsv("a,b,c\n1,2,3")).toEqual([
			["a", "b", "c"],
			["1", "2", "3"],
		]);
	});

	it("解析带引号字段（含逗号与换行）", () => {
		expect(parseCsv('"hello, world",x\n"line1\nline2",y')).toEqual([
			["hello, world", "x"],
			["line1\nline2", "y"],
		]);
	});

	it("解析双引号转义", () => {
		expect(parseCsv('"say ""hi""",ok')).toEqual([['say "hi"', "ok"]]);
	});

	it("兼容 \\r\\n 换行", () => {
		expect(parseCsv("a,b\r\nc,d")).toEqual([
			["a", "b"],
			["c", "d"],
		]);
	});

	it("空字段保留", () => {
		expect(parseCsv("a,,c")).toEqual([["a", "", "c"]]);
	});

	it("空文本返回空数组", () => {
		expect(parseCsv("")).toEqual([]);
	});

	it("引号未闭合时宽容返回已解析内容", () => {
		expect(parseCsv('"unclosed,field')).toEqual([["unclosed,field"]]);
	});
});
