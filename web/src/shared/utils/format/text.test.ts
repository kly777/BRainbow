import { describe, expect, it } from "vite-plus/test";
import { cjkSpace } from "./text.ts";

describe("cjkSpace", () => {
	it("汉字与拉丁相邻时补空格", () => {
		expect(cjkSpace("PCD里没有可用的点")).toBe("PCD 里没有可用的点");
		expect(cjkSpace("SVG上限 20 MB")).toBe("SVG 上限 20 MB");
		expect(cjkSpace("打开file查看")).toBe("打开 file 查看");
	});

	it("汉字与数字相邻时补空格", () => {
		expect(cjkSpace("至少4位")).toBe("至少 4 位");
		expect(cjkSpace("标签1; 标签2")).toBe("标签 1; 标签 2");
	});

	it("纯中文不动 —— 这正是不能在模板里写死空格的原因", () => {
		// 同一个模板 `` `${what}里没有可用的点` `` 收到中文实参时不该被动
		expect(cjkSpace("点云文件里没有可用的点")).toBe("点云文件里没有可用的点");
		expect(cjkSpace("图片上限 200 MB")).toBe("图片上限 200 MB");
		expect(cjkSpace("待复习")).toBe("待复习");
	});

	it("已经有空格的不会变成两个", () => {
		expect(cjkSpace("PCD 里没有可用的点")).toBe("PCD 里没有可用的点");
		expect(cjkSpace("已有 空格")).toBe("已有 空格");
	});

	it("不碰换行 —— 消息里的 \\n 是排版的一部分", () => {
		expect(cjkSpace("第一段\n第二段")).toBe("第一段\n第二段");
		// 换行两侧即便相邻也不插空格（不在同一行，插了没有意义）
		expect(cjkSpace("中文\nABC")).toBe("中文\nABC");
	});

	it("度数、百分号与数字之间不加空格（指北的例外）", () => {
		expect(cjkSpace("这是90°的角")).toBe("这是 90°的角");
		expect(cjkSpace("提升了15%")).toBe("提升了 15%");
	});

	it("本来就是空的或没有汉字时原样返回", () => {
		expect(cjkSpace("")).toBe("");
		expect(cjkSpace("plain ASCII 123")).toBe("plain ASCII 123");
	});
});
