// ── 电子书阅读位置与字号（纯函数） ──
//
// 存档只存"章号 + 章内比例"：存像素没意义（换字号/窗口后同一个像素落在别处）。
// 解析必须**严格** —— 书籍被替换后旧章号可能越界，宁可从头读也不要跳到半路。

import { describe, expect, it } from "vitest";
import {
	bookProgressKey,
	clampFontScaleIndex,
	DEFAULT_FONT_SCALE_INDEX,
	FONT_SCALES,
	fontScaleKey,
	parseBookProgress,
	parseFontScaleIndex,
	scrollRatioOf,
	serializeBookProgress,
} from "./bookProgress.ts";

describe("阅读位置存档", () => {
	it("键按文件区分，字号键是全局的", () => {
		expect(bookProgressKey("abc123")).toBe("file:book:abc123");
		expect(bookProgressKey("xyz")).not.toBe(bookProgressKey("abc123"));
		expect(fontScaleKey).toBe("file:book:font-scale");
	});

	it("存读往返", () => {
		const raw = serializeBookProgress({ chapter: 12, ratio: 0.42 });
		expect(parseBookProgress(raw)).toEqual({ chapter: 12, ratio: 0.42 });
	});

	it("比例越界时收敛到 0..1", () => {
		expect(parseBookProgress('{"chapter":1,"ratio":9}')?.ratio).toBe(1);
		expect(parseBookProgress('{"chapter":1,"ratio":-3}')?.ratio).toBe(0);
		expect(serializeBookProgress({ chapter: 1, ratio: 5 })).toBe(
			'{"chapter":1,"ratio":1}',
		);
	});

	it("残缺/损坏/越界的存档一律当作没有（宁可从头读）", () => {
		for (const raw of [
			null,
			"",
			"not json",
			"[]",
			"42",
			'{"chapter":-1,"ratio":0}',
			'{"chapter":1.5,"ratio":0}',
			'{"chapter":"1","ratio":0}',
			'{"chapter":1}',
			'{"chapter":1,"ratio":"half"}',
		]) {
			expect(parseBookProgress(raw), String(raw)).toBeUndefined();
		}
	});

	it("容器没有可滚动高度时比例为 0（不把 NaN 写进存档）", () => {
		expect(
			scrollRatioOf({ scrollTop: 0, scrollHeight: 0, clientHeight: 0 }),
		).toBe(0);
		expect(
			scrollRatioOf({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 }),
		).toBe(0);
		expect(
			scrollRatioOf({ scrollTop: 50, scrollHeight: 200, clientHeight: 100 }),
		).toBe(0.5);
	});
});

describe("字号档位", () => {
	it("档位是递增的，默认取中间那档", () => {
		expect(FONT_SCALES.length).toBeGreaterThan(1);
		expect(FONT_SCALES[DEFAULT_FONT_SCALE_INDEX]).toBe(1);
		for (let i = 1; i < FONT_SCALES.length; i++) {
			expect(FONT_SCALES[i]).toBeGreaterThan(FONT_SCALES[i - 1]);
		}
	});

	it("越界的档位收敛到两端", () => {
		expect(clampFontScaleIndex(-3)).toBe(0);
		expect(clampFontScaleIndex(99)).toBe(FONT_SCALES.length - 1);
		expect(clampFontScaleIndex(1.5)).toBe(DEFAULT_FONT_SCALE_INDEX);
	});

	it("没有存过 / 存了乱码时回到默认档", () => {
		expect(parseFontScaleIndex(null)).toBe(DEFAULT_FONT_SCALE_INDEX);
		expect(parseFontScaleIndex("abc")).toBe(DEFAULT_FONT_SCALE_INDEX);
		expect(parseFontScaleIndex("2")).toBe(2);
		expect(parseFontScaleIndex("-1")).toBe(0);
	});
});
