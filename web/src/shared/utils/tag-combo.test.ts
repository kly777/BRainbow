// ── 标签输入判定逻辑（file / bookmark / mem 三处共用） ──

import { describe, expect, it } from "vitest";
import {
	filterTagOptions,
	hasExactTagMatch,
	tagEnterTarget,
} from "./tag-combo.ts";

const TAGS = [
	{ id: 1, name: "工作" },
	{ id: 2, name: "工作日" },
	{ id: 3, name: "假期" },
];

const none = () => false;

describe("filterTagOptions", () => {
	it("query 为空时返回空数组（刚聚焦不该弹一屏候选）", () => {
		expect(filterTagOptions(TAGS, "", none)).toEqual([]);
		expect(filterTagOptions(TAGS, "   ", none)).toEqual([]);
	});

	it("按 name 包含匹配且忽略大小写", () => {
		expect(filterTagOptions(TAGS, "工", none)).toEqual([
			{ id: 1, name: "工作" },
			{ id: 2, name: "工作日" },
		]);
		const en = [{ id: 9, name: "Work" }];
		expect(filterTagOptions(en, "wOrK", none)).toEqual(en);
	});

	it("剔除已选项（按调用方给的判定）", () => {
		expect(filterTagOptions(TAGS, "工作", (t) => t.id === 1)).toEqual([
			{ id: 2, name: "工作日" },
		]);
	});
});

describe("hasExactTagMatch", () => {
	it("精确同名（忽略大小写与首尾空白）才算命中", () => {
		expect(hasExactTagMatch(TAGS, "工作")).toBe(true);
		expect(hasExactTagMatch(TAGS, " 工作 ")).toBe(true);
		expect(hasExactTagMatch(TAGS, "工")).toBe(false);
	});

	it("空 query 不算命中", () => {
		expect(hasExactTagMatch(TAGS, "")).toBe(false);
	});
});

describe("tagEnterTarget", () => {
	it("空 query 无事可做", () => {
		expect(tagEnterTarget(TAGS, "  ")).toBeNull();
	});

	it("精确命中候选时取那个候选（而不是候选里的第一条）", () => {
		// 候选顺序里 "工作日" 在前，但用户打的是 "工作" —— 该拿到 "工作"
		expect(tagEnterTarget(TAGS, "工作")).toEqual({
			kind: "option",
			option: { id: 1, name: "工作" },
		});
	});

	it("无精确命中但有候选时取第一条", () => {
		expect(tagEnterTarget(TAGS, "工")).toEqual({
			kind: "option",
			option: { id: 1, name: "工作" },
		});
	});

	it("命中已选中的同名标签时回落原文（不能顺手塞别的候选）", () => {
		// 用户打的是已选中的 "工作"，候选里只剩 "工作日"：不该把 "工作日" 加进去
		expect(tagEnterTarget([{ id: 2, name: "工作日" }], "工作", TAGS)).toEqual({
			kind: "text",
			text: "工作",
		});
	});

	it("候选为空且名字未知时回落输入原文（后端保存时自动建标签）", () => {
		expect(tagEnterTarget([], "新标签", TAGS)).toEqual({
			kind: "text",
			text: "新标签",
		});
	});
});
