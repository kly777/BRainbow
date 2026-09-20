// ── 深链状态（P4-5）：格式与边界 ──
//
// 最要紧的边界是"越界的深链"：链接可能是上一版文件留下的（那时有 30 章、现在只有 12 章），
// 这时必须**当没给**（回到开头），而不是跳到一个不存在的位置。

import { describe, expect, it } from "vitest";
import {
	buildViewParam,
	parseIndexPayload,
	parseViewParam,
	viewStateOf,
} from "./viewLink.ts";

describe("parseViewParam", () => {
	it("拆开 id 与状态串", () => {
		expect(parseViewParam("epub:12")).toEqual({ id: "epub", payload: "12" });
		// 状态串里带冒号也要完整保留（各查看器自己定义含义）
		expect(parseViewParam("xlsx:0:1")).toEqual({ id: "xlsx", payload: "0:1" });
	});

	it("没有参数 / 没有冒号 / id 为空 / 状态为空都当没给", () => {
		for (const raw of [undefined, "", "epub", ":12", "epub:", "   "]) {
			expect(parseViewParam(raw), String(raw)).toBeUndefined();
		}
	});
});

describe("viewStateOf", () => {
	it("只把属于这个查看器的状态给它（不匹配的忽略，不会串台）", () => {
		expect(viewStateOf("epub:12", "epub")).toBe("12");
		expect(viewStateOf("epub:12", "xlsx")).toBeUndefined();
		expect(viewStateOf(undefined, "epub")).toBeUndefined();
	});
});

describe("buildViewParam", () => {
	it("组装成 id:状态（数字直接可传）", () => {
		expect(buildViewParam("epub", 12)).toBe("epub:12");
		expect(buildViewParam("hex", "4096")).toBe("hex:4096");
		// 往返一致
		expect(viewStateOf(buildViewParam("xlsx", 2), "xlsx")).toBe("2");
	});
});

describe("parseIndexPayload", () => {
	it("解析非负整数", () => {
		expect(parseIndexPayload("0")).toBe(0);
		expect(parseIndexPayload("12")).toBe(12);
	});

	it("负数 / 小数 / 非数字 / 空都当没给", () => {
		for (const raw of ["-1", "1.5", "abc", "", undefined, "1e3"]) {
			expect(parseIndexPayload(raw), String(raw)).toBeUndefined();
		}
	});

	it("给了上限就越界当没给（链接来自上一版文件时不跳到不存在的位置）", () => {
		expect(parseIndexPayload("2", 3)).toBe(2);
		expect(parseIndexPayload("3", 3)).toBeUndefined();
		expect(parseIndexPayload("99", 12)).toBeUndefined();
	});
});
