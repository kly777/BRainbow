// ── 全局浮窗的类型前缀语义（A6 是回归红线）──
//
// `#购物` 必须仍创建名为"购物"的任务：`#` 在行首是**类型前缀**，不是标签。
// 新增的只是"剥掉前缀之后按行内 token 提取属性"这一步。

// 这个 hook 经 `@modules/task` 的 barrel 间接带进了 Solid 的 DOM 代码（UI 原子），
// node 环境下光 import 就会炸在 `window is not defined` —— 按项目惯例用文件头标注
// @vitest-environment jsdom

// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";
import { detectType } from "./useQuickCapture.ts";

describe("detectType：类型前缀", () => {
	it("`#购物` → 任务，标题「购物」（向后兼容，A6）", () => {
		const detected = detectType("#购物");
		expect(detected.type).toBe("task");
		expect(detected.cleanValue).toBe("购物");
	});

	it("`#` 开头但行首空白也算前缀", () => {
		expect(detectType("   #写周报").cleanValue).toBe("写周报");
	});

	it("`#购物 #家务` → 标题「购物」+ 标签「家务」", () => {
		const detected = detectType("#购物 #家务");
		expect(detected.type).toBe("task");
		expect(detected.cleanValue).toBe("购物");
		expect(detected.capture?.tags).toEqual(["家务"]);
	});

	it("`@https://x.com` → 书签（保持现状）", () => {
		const detected = detectType("@https://x.com");
		expect(detected.type).toBe("bookmark");
		expect(detected.url).toBe("https://x.com");
	});

	it("`@https://x.com 标题` → 书签 + 标题", () => {
		const detected = detectType("@https://x.com 好文章");
		expect(detected.type).toBe("bookmark");
		expect(detected.url).toBe("https://x.com");
		expect(detected.cleanValue).toBe("好文章");
	});

	it("`@bob 问下进度` 不是书签（`@` 后面不是 URL）→ 卡片", () => {
		const detected = detectType("@bob 问下进度");
		expect(detected.type).toBe("card");
		expect(detected.cleanValue).toBe("@bob 问下进度");
	});

	it("普通文本 → 卡片，正文原样（卡片不解析属性语法）", () => {
		const detected = detectType("今天想到的一个点子 #灵感");
		expect(detected.type).toBe("card");
		expect(detected.cleanValue).toBe("今天想到的一个点子 #灵感");
		expect(detected.capture).toBeUndefined();
	});
});

describe("detectType：任务前缀之后的属性解析", () => {
	it("`#写周报 !p1 ~60m` → 标题、优先级、时长都到位", () => {
		const detected = detectType("#写周报 !p1 ~60m");
		expect(detected.cleanValue).toBe("写周报");
		expect(detected.capture?.priority).toBe("p1");
		expect(detected.capture?.effortMinutes).toBe(60);
	});

	it("`# 写周报`（前缀与内容之间有空隙）也认", () => {
		expect(detectType("#  写周报").cleanValue).toBe("写周报");
	});
});
