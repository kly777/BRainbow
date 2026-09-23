// ── InfoHint：把"常驻说明文字"收进 ⓘ 气泡 ──

import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { describe, expect, it } from "vitest";
import InfoHint from "./InfoHint.tsx";

/** 渲染一个 hint，返回宿主与 Tooltip 的 wrap span */
function setup(children: () => JSX.Element) {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const dispose = render(children, host);
	return {
		host,
		wrap: host.firstElementChild as HTMLElement,
		dispose: () => {
			dispose();
			host.remove();
		},
	};
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

/**
 * 等气泡出现：Tooltip 默认有 300ms 的悬浮延迟（避免扫过就弹），
 * 所以这里轮询等它，而不是假设立刻就有。
 */
async function waitForTooltip() {
	for (let i = 0; i < 60; i++) {
		const tip = document.querySelector('[role="tooltip"]');
		if (tip) return tip.textContent ?? "";
		await tick();
	}
	return null;
}

describe("InfoHint", () => {
	it("触发图标是一个按钮，无障碍名称来自 label", () => {
		const { host, dispose } = setup(() => (
			<InfoHint label="关于服务器信息的说明">数据、上传与备份同盘</InfoHint>
		));
		const trigger = host.querySelector("button");
		expect(trigger).toBeTruthy();
		expect(trigger?.getAttribute("aria-label")).toBe("关于服务器信息的说明");
		// 图标本身不该进无障碍名称（否则读屏器会念出一串图形名称）
		expect(trigger?.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
			"true",
		);
		dispose();
	});

	it("悬浮时展开内容", async () => {
		const { wrap, dispose } = setup(() => (
			<InfoHint label="说明" position="top">
				没配备份目录时显示 —
			</InfoHint>
		));
		expect(document.querySelector('[role="tooltip"]')).toBeNull();
		wrap.dispatchEvent(new MouseEvent("mouseenter"));
		expect(await waitForTooltip()).toContain("没配备份目录时显示 —");
		dispose();
	});

	it("键盘聚焦也能展开（不能只靠 hover）", async () => {
		const { host, dispose } = setup(() => (
			<InfoHint label="说明">键盘可用</InfoHint>
		));
		host
			.querySelector("button")
			?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
		expect(await waitForTooltip()).toContain("键盘可用");
		dispose();
	});
});
