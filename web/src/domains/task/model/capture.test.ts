// 单测矩阵照 doc/design/task-ux/03-录入模型.md §5 的八组抄下来 —— 每条都是规格，
// 不是"顺手写的断言"：改了语法就得同时改这里与那份文档。

import { describe, expect, it } from "vite-plus/test";
import {
	addTagToken,
	parseCapture,
	removeTagToken,
	setEffortToken,
	setPriorityToken,
} from "./capture.ts";

describe("前缀兼容（全局浮窗的类型前缀由 detectType 处理，这里只看行内 token）", () => {
	it("`#x` 在任务录入框里是标签、不是类型前缀", () => {
		const r = parseCapture("#x");
		expect(r.tags).toEqual(["x"]);
		expect(r.cleanTitle).toBe(""); // 只剩标签 → 标题为空，提交时拒绝
	});

	it("`#x y` → 标签 x + 标题 y", () => {
		const r = parseCapture("#x y");
		expect(r.tags).toEqual(["x"]);
		expect(r.cleanTitle).toBe("y");
	});

	it("`#x #y` → 两个标签", () => {
		expect(parseCapture("#x #y").tags).toEqual(["x", "y"]);
	});

	it("URL 与 `@` 开头的 URL 都不是标签/提及（后者在浮窗里是书签）", () => {
		for (const input of ["https://a.b", "@https://a.b"]) {
			const r = parseCapture(input);
			expect(r.tags).toEqual([]);
			expect(r.mentions).toEqual([]);
			expect(r.cleanTitle).toBe(input);
			expect(r.unparsed).toEqual([]);
		}
	});
});

describe("优先级", () => {
	it("`!p1` → p1，且不出现在标题里", () => {
		const r = parseCapture("写周报 !p1");
		expect(r.priority).toBe("p1");
		expect(r.cleanTitle).toBe("写周报");
	});

	it("大小写不敏感：`!P1` = `!p1`", () => {
		expect(parseCapture("!P1").priority).toBe("p1");
	});

	it("`!p5` 不是合法优先级 → 留在标题里，且记进 unparsed", () => {
		const r = parseCapture("写周报 !p5");
		expect(r.priority).toBeNull();
		expect(r.cleanTitle).toBe("写周报 !p5");
		expect(r.unparsed).toEqual(["!p5"]);
	});

	it("重复出现取第一个（`!p3 !p1` → p3），两个都不留成标题噪音", () => {
		const r = parseCapture("写周报 !p3 !p1");
		expect(r.priority).toBe("p3");
		expect(r.cleanTitle).toBe("写周报");
	});

	it("`!p1x` 整个 token 不匹配 → 不解析", () => {
		const r = parseCapture("!p1x");
		expect(r.priority).toBeNull();
		expect(r.cleanTitle).toBe("!p1x");
		expect(r.unparsed).toEqual(["!p1x"]);
	});

	it("`p1`（无 `!`）不解析，且不算「误报」（不进 unparsed）", () => {
		const r = parseCapture("p1 报表");
		expect(r.priority).toBeNull();
		expect(r.cleanTitle).toBe("p1 报表");
		expect(r.unparsed).toEqual([]);
	});
});

describe("标签", () => {
	it("`#工作` → 标签", () => {
		expect(parseCapture("买 #工作").tags).toEqual(["工作"]);
	});

	it("`#a#b` → 一个标签（`#` 不是 token 分界，名字截到第二个 `#`）", () => {
		const r = parseCapture("#a#b");
		expect(r.tags).toEqual(["a"]);
		// 没被吃掉的部分留在标题里（不静默丢字）
		expect(r.cleanTitle).toBe("#b");
	});

	it("`#a-b_c` → 连字符与下划线都在允许集里", () => {
		expect(parseCapture("#a-b_c").tags).toEqual(["a-b_c"]);
	});

	it("`#a,b` → 截到逗号（标签取允许字符的最长前缀）", () => {
		const r = parseCapture("#a,b");
		expect(r.tags).toEqual(["a"]);
		expect(r.cleanTitle).toBe(",b");
	});

	it("`#`（没有名字）不解析", () => {
		const r = parseCapture("光秃秃的 #");
		expect(r.tags).toEqual([]);
		expect(r.cleanTitle).toBe("光秃秃的 #");
		expect(r.unparsed).toEqual(["#"]);
	});

	it("`买牛奶#加急` 不构成 token 分界 → 整串是标题，没有标签", () => {
		const r = parseCapture("买牛奶#加急");
		expect(r.tags).toEqual([]);
		expect(r.cleanTitle).toBe("买牛奶#加急");
		expect(r.unparsed).toEqual([]);
	});

	it("超过 32 字符的名字不算标签（整 token 留标题）", () => {
		const long = "x".repeat(33);
		const r = parseCapture(`#${long}`);
		expect(r.tags).toEqual([]);
		expect(r.cleanTitle).toBe(`#${long}`);
	});
});

describe("时长", () => {
	it.each([
		["~60m", 60],
		["~60min", 60],
		["~1.5h", 90],
		["~2hr", 120],
		["~2小时", 120],
		["~90", 90], // 裸数字按分钟
		["~30分钟", 30],
	])("%s → %i 分钟", (token, expected) => {
		const r = parseCapture(`写周报 ${token}`);
		expect(r.effortMinutes).toBe(expected);
		expect(r.cleanTitle).toBe("写周报");
	});

	it("`~0` 不解析（0 分钟没有意义）", () => {
		const r = parseCapture("~0");
		expect(r.effortMinutes).toBeNull();
		expect(r.unparsed).toEqual(["~0"]);
	});

	it("`~abc` / `~1d` 不解析", () => {
		for (const token of ["~abc", "~1d"]) {
			const r = parseCapture(`写周报 ${token}`);
			expect(r.effortMinutes).toBeNull();
			expect(r.cleanTitle).toBe(`写周报 ${token}`);
			expect(r.unparsed).toEqual([token]);
		}
	});

	it("重复出现取第一个", () => {
		const r = parseCapture("~30m ~60m");
		expect(r.effortMinutes).toBe(30);
		expect(r.cleanTitle).toBe("");
	});
});

describe("提及", () => {
	it("`@bob` → 提及并从标题里剥离", () => {
		const r = parseCapture("问下进度 @bob");
		expect(r.mentions).toEqual(["bob"]);
		expect(r.cleanTitle).toBe("问下进度");
	});

	it("多个提及都保留", () => {
		expect(parseCapture("@bob @alice 开会").mentions).toEqual(["bob", "alice"]);
	});

	it("`a@b.com` 不是提及（`@` 前是字母，不成 token 分界）", () => {
		const r = parseCapture("联系 a@b.com");
		expect(r.mentions).toEqual([]);
		expect(r.cleanTitle).toBe("联系 a@b.com");
		expect(r.unparsed).toEqual([]);
	});
});

describe("顺序无关", () => {
	it("`!p1 #a 写周报` ≡ `写周报 !p1 #a`", () => {
		const a = parseCapture("!p1 #a 写周报");
		const b = parseCapture("写周报 !p1 #a");
		expect(a.cleanTitle).toBe(b.cleanTitle);
		expect(a.priority).toBe(b.priority);
		expect(a.tags).toEqual(b.tags);
	});
});

describe("标题归一", () => {
	it("多空格折叠 + 首尾不留白", () => {
		expect(parseCapture("写周报   !p1").cleanTitle).toBe("写周报");
		expect(parseCapture("  写   周报  ").cleanTitle).toBe("写 周报");
	});

	it("只剩符号 → 标题为空（提交时拒绝，A1）", () => {
		expect(parseCapture("!p1").cleanTitle).toBe("");
		expect(parseCapture("   ").cleanTitle).toBe("");
		expect(parseCapture("#工作 ~30m").cleanTitle).toBe("");
	});

	it("原始输入留在 title 里（预览要显示「我原本写了什么」）", () => {
		expect(parseCapture("  写周报 !p1  ").title).toBe("写周报 !p1");
	});
});

describe("组合与不解析日期的红线", () => {
	it("`写周报 !p1 @bob #工作 15:00 周五 ~60m` 一次解析到位", () => {
		const r = parseCapture("写周报 !p1 @bob #工作 15:00 周五 ~60m");
		expect(r.priority).toBe("p1");
		expect(r.tags).toEqual(["工作"]);
		expect(r.mentions).toEqual(["bob"]);
		expect(r.effortMinutes).toBe(60);
		// `15:00` 与 `周五` 原样留在标题 —— 标题行永不解析日期
		expect(r.cleanTitle).toBe("写周报 15:00 周五");
		expect(r.unparsed).toEqual([]);
	});

	it("中文标签免转义", () => {
		expect(parseCapture("#家务 #购物清单").tags).toEqual(["家务", "购物清单"]);
	});
});

describe("回写：第 2 层控件改文本（两层是同一份状态）", () => {
	it("设优先级：旧 token 被替换，不留两份", () => {
		expect(setPriorityToken("写周报 !p1", "p2")).toBe("写周报 !p2");
	});

	it("设优先级：原本没有就追加", () => {
		expect(setPriorityToken("写周报", "p1")).toBe("写周报 !p1");
		expect(setPriorityToken("", "p1")).toBe("!p1");
	});

	it("设优先级：null = 删掉", () => {
		expect(setPriorityToken("写周报 !p1", null)).toBe("写周报");
		expect(setPriorityToken("!p1", null)).toBe("");
	});

	it("回写后解析结果与新控件值一致（闭环）", () => {
		const text = setPriorityToken("写周报 #工作 ~60m", "p3");
		const r = parseCapture(text);
		expect(r.priority).toBe("p3");
		expect(r.tags).toEqual(["工作"]);
		expect(r.effortMinutes).toBe(60);
		expect(r.cleanTitle).toBe("写周报");
	});

	it("设时长：`~1.5h` 被换成规范写法 `~90m`", () => {
		expect(setEffortToken("写周报 ~1.5h", 90)).toBe("写周报 ~90m");
		expect(setEffortToken("写周报 ~1.5h", null)).toBe("写周报");
	});

	it("加标签：追加、去重、中文直接写", () => {
		expect(addTagToken("买牛奶", "工作")).toBe("买牛奶 #工作");
		expect(addTagToken("买牛奶 #工作", "工作")).toBe("买牛奶 #工作");
		expect(addTagToken("", "工作")).toBe("#工作");
	});

	it("删标签：只删那一个", () => {
		expect(removeTagToken("买牛奶 #工作 #家", "工作")).toBe("买牛奶 #家");
		expect(removeTagToken("#工作", "工作")).toBe("");
	});

	it("名字里有正则元字符也不炸", () => {
		expect(addTagToken("x", "a+b")).toBe("x #a+b");
		expect(removeTagToken("x #a+b", "a+b")).toBe("x");
	});
});
