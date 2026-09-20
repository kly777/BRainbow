// ── 复制反馈的契约测试 ──
// 两条：到期自动清除；到期回调只清除"自己那一次"（否则连续抄几个值的时候，
// 前一个的定时器会把后一个的高亮提前掐掉）。

import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCopyFlash } from "./useCopyFlash.ts";

function setup(durationMs = 30) {
	let api!: ReturnType<typeof useCopyFlash>;
	const host = document.createElement("div");
	document.body.appendChild(host);
	render(() => {
		api = useCopyFlash({ durationMs });
		return null;
	}, host);
	return api;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("useCopyFlash", () => {
	it("标记后进入闪烁态，到期自动清除", async () => {
		const api = setup();
		expect(api.copiedKey()).toBeUndefined();

		api.flash("title");
		expect(api.copiedKey()).toBe("title");

		await wait(60);
		expect(api.copiedKey()).toBeUndefined();
	});

	it("连续复制不同键时，先前的定时器不会掐掉后一个的高亮", async () => {
		const api = setup(40);
		api.flash("first");
		await wait(20);
		api.flash("second");

		// 走到第一个的到期时刻：second 必须还在亮
		await wait(30);
		expect(api.copiedKey()).toBe("second");

		// 到自己该灭的时候才灭
		await wait(40);
		expect(api.copiedKey()).toBeUndefined();
	});
});
