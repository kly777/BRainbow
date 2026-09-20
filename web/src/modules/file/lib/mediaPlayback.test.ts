// ── 音视频的播放偏好：倍速与进度记忆（纯函数） ──
//
// 两条护栏最值得钉住：**太靠后就从头播**（片尾不该再放一遍），
// **超出时长的旧记录丢弃**（文件被换成更短的版本时不能跳到不存在的秒数）。

import { describe, expect, it } from "vitest";
import {
	clampSpeedIndex,
	DEFAULT_SPEED_INDEX,
	parsePosition,
	parseSpeedIndex,
	positionKey,
	resumeAt,
	SPEED_STEPS,
	speedKey,
	stepSpeedIndex,
	worthSaving,
} from "./mediaPlayback.ts";

describe("倍速", () => {
	it("默认 1×，档位递增", () => {
		expect(SPEED_STEPS[DEFAULT_SPEED_INDEX]).toBe(1);
		for (let i = 1; i < SPEED_STEPS.length; i++) {
			expect(SPEED_STEPS[i]).toBeGreaterThan(SPEED_STEPS[i - 1]);
		}
	});

	it("切换档位；到头停住", () => {
		expect(stepSpeedIndex(2, 1)).toBe(3);
		expect(stepSpeedIndex(2, -1)).toBe(1);
		expect(stepSpeedIndex(SPEED_STEPS.length - 1, 1)).toBe(
			SPEED_STEPS.length - 1,
		);
		expect(stepSpeedIndex(0, -1)).toBe(0);
	});

	it("越界/乱码的存档回到默认档", () => {
		expect(parseSpeedIndex(null)).toBe(DEFAULT_SPEED_INDEX);
		expect(parseSpeedIndex("abc")).toBe(DEFAULT_SPEED_INDEX);
		expect(parseSpeedIndex("99")).toBe(SPEED_STEPS.length - 1);
		expect(parseSpeedIndex("-2")).toBe(0);
		expect(clampSpeedIndex(1.5)).toBe(DEFAULT_SPEED_INDEX);
	});

	it("倍速是全局键，进度按文件分开（且分音视频）", () => {
		expect(speedKey).toBe("file:media:speed");
		expect(positionKey("video", "abc")).toBe("file:media:video:abc");
		expect(positionKey("audio", "abc")).not.toBe(positionKey("video", "abc"));
	});
});

describe("播放进度", () => {
	it("解析：非法值当作没有", () => {
		expect(parsePosition(null)).toBeUndefined();
		expect(parsePosition("")).toBeUndefined();
		expect(parsePosition("abc")).toBeUndefined();
		expect(parsePosition("-1")).toBeUndefined();
		expect(parsePosition("42.5")).toBe(42.5);
	});

	it("正常续播", () => {
		expect(resumeAt(120, 600)).toBe(120);
	});

	it("没有存档 / 存档在开头 → 从头播", () => {
		expect(resumeAt(undefined, 600)).toBe(0);
		expect(resumeAt(0, 600)).toBe(0);
	});

	it("存档在结尾附近 → 从头播（片尾不该再放一遍）", () => {
		// 还剩 10 秒（< NEAR_END_SECONDS）
		expect(resumeAt(590, 600)).toBe(0);
		// 剩余 0.5%（< NEAR_END_RATIO），即使绝对秒数还不少
		expect(resumeAt(9950, 10000)).toBe(0);
	});

	it("存档超出时长（文件被换成更短的）→ 从头播", () => {
		expect(resumeAt(900, 600)).toBe(0);
	});

	it("时长未知时保留存档（元数据还没到）", () => {
		expect(resumeAt(120, 0)).toBe(120);
		expect(resumeAt(120, Number.NaN)).toBe(120);
	});

	it("开头几秒不值得存档（省得一进去就写一条'看过'）", () => {
		expect(worthSaving(2, 600)).toBe(false);
		expect(worthSaving(120, 600)).toBe(true);
		// 结尾附近也不写：下次本来就从头播，写了也白写
		expect(worthSaving(595, 600)).toBe(false);
	});
});
