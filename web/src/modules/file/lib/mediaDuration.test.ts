// ── 上传前读媒体时长（纯函数 + 注入假元素的路径测试） ──
//
// jsdom 不解码媒体，也不实现 URL.createObjectURL，所以这里注入一个假元素把
// 三条出口走全：读到值 / 元素报错 / 超时。真实浏览器里的行为由这三条覆盖。

import { describe, expect, it, vi } from "vitest";
import { mediaKind, readMediaDuration, toMillis } from "./mediaDuration.ts";

/** 假媒体元素：只保留用到的几个 API */
function fakeElement(kind: "video" | "audio"): HTMLMediaElement {
	const el = document.createElement(kind);
	el.load = vi.fn();
	return el;
}

const file = (type: string) =>
	new File([new Uint8Array([1, 2, 3])], "x", { type });

describe("mediaKind", () => {
	it("只有音视频需要读时长", () => {
		expect(mediaKind("video/mp4")).toBe("video");
		expect(mediaKind("audio/mpeg")).toBe("audio");
		// 图片/文档/未知都不读：给它们也走一遍解码纯属浪费
		expect(mediaKind("image/png")).toBeUndefined();
		expect(mediaKind("application/pdf")).toBeUndefined();
		expect(mediaKind("")).toBeUndefined();
	});
});

describe("toMillis", () => {
	it("秒转毫秒并取整", () => {
		expect(toMillis(2.5)).toBe(2500);
		expect(toMillis(0.001)).toBe(1);
	});

	it("流式容器的 Infinity/NaN 与 0 都当读不出", () => {
		// 还没读到头时 duration 是 Infinity：乘 1000 会变成 JSON 里的 null
		expect(toMillis(Number.POSITIVE_INFINITY)).toBeUndefined();
		expect(toMillis(Number.NaN)).toBeUndefined();
		expect(toMillis(0)).toBeUndefined();
		expect(toMillis(-1)).toBeUndefined();
	});
});

describe("readMediaDuration", () => {
	it("非音视频直接返回 undefined，不碰 DOM", async () => {
		const createElement = vi.fn(fakeElement);
		expect(
			await readMediaDuration(file("image/png"), { createElement }),
		).toBeUndefined();
		expect(createElement).not.toHaveBeenCalled();
	});

	it("读到 metadata 就给毫秒", async () => {
		const el = fakeElement("video");
		const p = readMediaDuration(file("video/mp4"), {
			createElement: () => el,
			timeoutMs: 50,
		});
		Object.defineProperty(el, "duration", { value: 12.5, configurable: true });
		el.dispatchEvent(new Event("loadedmetadata"));

		expect(await p).toBe(12500);
		expect(el.load).toHaveBeenCalled(); // 主动断开解码，别留句柄
	});

	it("读不出（浏览器解不了这个容器）也返回 undefined，不抛", async () => {
		const el = fakeElement("audio");
		const p = readMediaDuration(file("audio/x-ape"), {
			createElement: () => el,
			timeoutMs: 50,
		});
		el.dispatchEvent(new Event("error"));

		expect(await p).toBeUndefined();
	});

	it("超时就放弃（上传不该卡在读时长上）", async () => {
		const el = fakeElement("video");
		expect(
			await readMediaDuration(file("video/mkv"), {
				createElement: () => el,
				timeoutMs: 5,
			}),
		).toBeUndefined();
	});

	it("metadata 与超时都到达时只结算一次", async () => {
		const el = fakeElement("video");
		const p = readMediaDuration(file("video/mp4"), {
			createElement: () => el,
			timeoutMs: 5,
		});
		Object.defineProperty(el, "duration", { value: 1, configurable: true });
		el.dispatchEvent(new Event("loadedmetadata"));
		await new Promise((r) => setTimeout(r, 15));

		expect(await p).toBe(1000);
	});
});
