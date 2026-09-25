// ── Toast 渲染契约测试 ──
// 此前只断言 `typeof Toast === "function"`；store 侧的逻辑由 toastStore.test.ts 覆盖，
// 这里补的是**渲染层**：四类 toast 的类名与图标、details 落 code、关闭按钮、
// 倒计时进度条的有无、空列表不渲染容器。

import { dismissAll, showToast, toasts } from "@shared/utils/toastStore.ts";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ToastContainer from "./Toast.tsx";

let dispose: (() => void) | undefined;

/**
 * 挂载容器。**必须销毁**：容器订阅的是全局 store，上一个用例的容器若还活着，
 * 这里再挂一个就会出现两个容器同时渲染同一条 toast（断言会看到 2 个 alert）。
 */
function mount() {
	document.body.innerHTML = "";
	const host = document.createElement("div");
	document.body.appendChild(host);
	dispose = render(() => <ToastContainer />, host);
}

const alerts = () => [...document.querySelectorAll('[role="alert"]')];

beforeEach(() => {
	vi.useFakeTimers();
	dismissAll();
});
afterEach(() => {
	dismissAll();
	dispose?.();
	dispose = undefined;
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("ToastContainer", () => {
	it("没有 toast 时不渲染容器", () => {
		mount();
		expect(document.querySelector('[role="status"]')).toBeNull();
		expect(alerts()).toHaveLength(0);
	});

	it("一条 toast 渲染出标题、消息与可访问角色", () => {
		mount();
		showToast({
			type: "error",
			title: "保存失败",
			message: "网络连接失败",
			duration: 0,
		});
		vi.advanceTimersByTime(1);

		expect(alerts()).toHaveLength(1);
		expect(alerts()[0].textContent).toContain("保存失败");
		expect(alerts()[0].textContent).toContain("网络连接失败");
		// 容器负责播报（区域级 aria-live），卡片是 alert
		expect(document.querySelector('[role="status"]')).toBeTruthy();
	});

	it("四类 toast 各自映射到不同类名", () => {
		mount();
		for (const type of ["error", "warning", "success", "info"] as const) {
			dismissAll();
			showToast({ type, title: type, message: "", duration: 0 });
			vi.advanceTimersByTime(1);
			const cls = alerts()[0].className;
			expect(cls).toContain(`_${type}_`);
			expect(cls).toContain("_toast_");
		}
	});

	it("details 用 <code> 呈现（错误码这类机器可读信息）", () => {
		mount();
		showToast({
			type: "warning",
			title: "请先登录",
			message: "登录已过期",
			details: "UNAUTHORIZED",
			duration: 0,
		});
		vi.advanceTimersByTime(1);

		expect(alerts()[0].querySelector("code")?.textContent).toBe("UNAUTHORIZED");
	});

	it("duration>0 才有倒计时进度条，0 则没有", () => {
		mount();
		showToast({ type: "info", title: "有进度条", message: "", duration: 5000 });
		vi.advanceTimersByTime(1);
		expect(alerts()[0].querySelector('[class*="progress"]')).toBeTruthy();

		dismissAll();
		showToast({ type: "info", title: "无进度条", message: "", duration: 0 });
		vi.advanceTimersByTime(1);
		expect(alerts()[0].querySelector('[class*="progress"]')).toBeNull();
	});

	it("关闭按钮带可访问名，点击后进入 leaving 并最终移除", () => {
		mount();
		showToast({ type: "success", title: "已保存", message: "", duration: 0 });
		vi.advanceTimersByTime(1);

		const close = alerts()[0].querySelector("button") as HTMLButtonElement;
		expect(close.getAttribute("aria-label")).toBe("关闭通知");

		close.click();
		vi.advanceTimersByTime(1);
		// dismissToast 先标 leaving（动画），300ms 后才真正移除
		expect(alerts()[0].className).toContain("_leaving_");
		expect(toasts()).toHaveLength(1);

		vi.advanceTimersByTime(300);
		expect(toasts()).toHaveLength(0);
	});
});
