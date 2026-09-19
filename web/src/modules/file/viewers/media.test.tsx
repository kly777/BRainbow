// ── useMediaPlayback：倍速落盘、按存档续播、离开时定档 ──
//
// jsdom 不实现真正的播放，但媒体元素的事件与 `currentTime` / `duration` / `playbackRate`
// 都是可写的普通属性 —— 手工派发 loadedmetadata / timeupdate 就能把整条链路跑通。

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioViewer } from "./AudioViewer.tsx";
import { item } from "./test-fixtures.ts";
import { VideoViewer } from "./VideoViewer.tsx";

/** 把元素的媒体属性补上（jsdom 里它们是只读/恒为 0 的） */
function fakeMedia(el: HTMLMediaElement, duration: number) {
	Object.defineProperty(el, "duration", {
		value: duration,
		configurable: true,
	});
	let currentTime = 0;
	Object.defineProperty(el, "currentTime", {
		get: () => currentTime,
		set: (v: number) => {
			currentTime = v;
		},
		configurable: true,
	});
	return {
		seekTo(seconds: number) {
			currentTime = seconds;
		},
		read: () => currentTime,
	};
}

function mount(view: typeof VideoViewer, storedId = "s1") {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	const props = {
		item: item({
			stored_id: storedId,
			mime_type: view === VideoViewer ? "video/mp4" : "audio/mpeg",
			original_name: view === VideoViewer ? "a.mp4" : "a.mp3",
		}),
	};
	render(
		() =>
			view === VideoViewer ? (
				<VideoViewer item={props.item} />
			) : (
				<AudioViewer item={props.item} />
			),
		host,
	);
	return host;
}

const media = (host: HTMLElement) =>
	host.querySelector("video, audio") as HTMLMediaElement;
const speedValue = (host: HTMLElement) =>
	host.querySelector("[class*='mediaSpeedValue']")?.textContent?.trim();
const speedBtn = (host: HTMLElement, label: string) =>
	host.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`);

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useMediaPlayback（视频）", () => {
	it("默认原速；点时按档位加减并落盘", async () => {
		const host = mount(VideoViewer);
		await Promise.resolve();
		expect(speedValue(host)).toBe("1×");

		speedBtn(host, "提高播放速度")?.click();
		await Promise.resolve();
		expect(speedValue(host)).toBe("1.25×");
		expect(media(host).playbackRate).toBe(1.25);
		expect(localStorage.getItem("file:media:speed")).toBe("3");

		speedBtn(host, "降低播放速度")?.click();
		await Promise.resolve();
		expect(speedValue(host)).toBe("1×");
	});

	it("倍速是全局偏好：另一个查看器也用它", async () => {
		localStorage.setItem("file:media:speed", "5"); // 2×
		const host = mount(AudioViewer);
		await Promise.resolve();
		expect(speedValue(host)).toBe("2×");
	});

	it("有存档时跳到上次位置并给一句说明", async () => {
		localStorage.setItem("file:media:video:s1", "120");
		const host = mount(VideoViewer);
		await Promise.resolve();
		const el = media(host);
		const control = fakeMedia(el, 600);

		el.dispatchEvent(new Event("loadedmetadata"));
		expect(control.read()).toBe(120);
		expect(host.textContent).toContain("已跳到上次的播放位置");
	});

	it("存档已在片尾时从头播（不显示续播提示）", async () => {
		localStorage.setItem("file:media:video:s1", "595");
		const host = mount(VideoViewer);
		await Promise.resolve();
		const el = media(host);
		const control = fakeMedia(el, 600);

		el.dispatchEvent(new Event("loadedmetadata"));
		expect(control.read()).toBe(0);
		expect(host.textContent).not.toContain("已跳到上次的播放位置");
	});

	it("播放中按节流写档（timeupdate 不会每次都写）", async () => {
		vi.useFakeTimers();
		const host = mount(VideoViewer);
		await Promise.resolve();
		const el = media(host);
		const control = fakeMedia(el, 600);
		el.dispatchEvent(new Event("loadedmetadata"));

		control.seekTo(60);
		el.dispatchEvent(new Event("timeupdate"));
		expect(localStorage.getItem("file:media:video:s1")).toBe("60");

		// 紧接着再来一次：节流未到，不写
		control.seekTo(61);
		el.dispatchEvent(new Event("timeupdate"));
		expect(localStorage.getItem("file:media:video:s1")).toBe("60");

		// 过了节流窗口就写
		vi.advanceTimersByTime(5000);
		control.seekTo(62);
		el.dispatchEvent(new Event("timeupdate"));
		expect(localStorage.getItem("file:media:video:s1")).toBe("62");
		vi.useRealTimers();
	});

	it("暂停时立刻写档", async () => {
		const host = mount(VideoViewer);
		await Promise.resolve();
		const el = media(host);
		const control = fakeMedia(el, 600);
		el.dispatchEvent(new Event("loadedmetadata"));

		control.seekTo(200);
		el.dispatchEvent(new Event("pause"));
		expect(localStorage.getItem("file:media:video:s1")).toBe("200");
	});

	it("音视频的档分开存（同一个 stored_id 不互相覆盖）", async () => {
		const host = mount(VideoViewer, "same-id");
		await Promise.resolve();
		const el = media(host);
		const control = fakeMedia(el, 600);
		el.dispatchEvent(new Event("loadedmetadata"));
		control.seekTo(100);
		el.dispatchEvent(new Event("pause"));

		expect(localStorage.getItem("file:media:video:same-id")).toBe("100");
		expect(localStorage.getItem("file:media:audio:same-id")).toBeNull();
	});
});
