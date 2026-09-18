// ── 查找的核心判定（纯函数） ──
//
// 边界值得钉住的几条：大小写不敏感、用户输入的正则元字符按字面匹配、
// 命中数上限（大文件里查一个字母）、空查询不返回"0/0"。

import { describe, expect, it } from "vitest";
import { findInTextNodes, MAX_MATCHES } from "./findInText.ts";

describe("findInTextNodes", () => {
	it("按出现顺序返回位置（节点索引 + 节点内偏移）", () => {
		const result = findInTextNodes(["foo bar foo", "foo"], "foo");
		expect(result.matches).toEqual([
			{ nodeIndex: 0, start: 0, end: 3 },
			{ nodeIndex: 0, start: 8, end: 11 },
			{ nodeIndex: 1, start: 0, end: 3 },
		]);
		expect(result.capped).toBe(false);
	});

	it("不区分大小写", () => {
		const result = findInTextNodes(["Hello HELLO hello"], "hello");
		expect(result.matches.map((m) => m.start)).toEqual([0, 6, 12]);
	});

	it("正则元字符按字面匹配（用户输入 . * ( 不该被当模式）", () => {
		// 若没转义，"." 会匹配任意字符 → 命中数会变成 4
		const dots = findInTextNodes(["a.b"], ".");
		expect(dots.matches).toEqual([{ nodeIndex: 0, start: 1, end: 2 }]);

		const paren = findInTextNodes(["f(x) 与 fx"], "f(x)");
		expect(paren.matches).toEqual([{ nodeIndex: 0, start: 0, end: 4 }]);
	});

	it("中文与跨节点各自独立匹配", () => {
		const result = findInTextNodes(["日志：任务失败", "任务重试"], "任务");
		expect(result.matches).toEqual([
			{ nodeIndex: 0, start: 3, end: 5 },
			{ nodeIndex: 1, start: 0, end: 2 },
		]);
	});

	it("空查询 / 纯空白返回空结果（界面据此显示「输入关键字」）", () => {
		expect(findInTextNodes(["abc"], "").matches).toEqual([]);
		expect(findInTextNodes(["abc"], "   ").matches).toEqual([]);
	});

	it("命中数触顶时 capped=true（大文件里查单字母）", () => {
		const text = "a".repeat(MAX_MATCHES + 100);
		const result = findInTextNodes([text], "a");
		expect(result.matches.length).toBe(MAX_MATCHES);
		expect(result.capped).toBe(true);
	});

	it("空节点与空数组不炸", () => {
		expect(findInTextNodes([], "x").matches).toEqual([]);
		expect(findInTextNodes(["", "x"], "x").matches).toEqual([
			{ nodeIndex: 1, start: 0, end: 1 },
		]);
	});
});
