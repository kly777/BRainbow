import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissAll, dismissToast, showToast, toasts } from "./toastStore";

beforeEach(() => {
	vi.useFakeTimers();
	dismissAll();
});

afterEach(() => {
	vi.useRealTimers();
});

// ── showToast ──

describe("toastStore", () => {
	describe("showToast", () => {
		it("adds a toast with auto-incrementing id", () => {
			const id1 = showToast({
				type: "info",
				title: "标题1",
				message: "消息1",
				duration: 3000,
			});
			const id2 = showToast({
				type: "error",
				title: "标题2",
				message: "消息2",
				duration: 3000,
			});

			expect(id2).toBe(id1 + 1);
			expect(toasts().length).toBe(2);
			expect(toasts()[0].title).toBe("标题1");
			expect(toasts()[1].title).toBe("标题2");
		});

		it("new toast has leaving=false", () => {
			showToast({
				type: "success",
				title: "成功",
				message: "操作完成",
				duration: 3000,
			});
			expect(toasts()[0].leaving).toBe(false);
		});

		it("defaults duration to 5000", () => {
			showToast({
				type: "info",
				title: "默认",
				message: "测试",
			});
			expect(toasts()[0].duration).toBe(5000);
		});

		it("duration=0 does not auto-dismiss", () => {
			showToast({
				type: "info",
				title: "永久",
				message: "不会消失",
				duration: 0,
			});

			vi.advanceTimersByTime(10000);
			expect(toasts().length).toBe(1);
		});
	});

	// ── auto-dismiss ──

	describe("auto-dismiss", () => {
		it("auto-dismisses after duration", () => {
			showToast({
				type: "info",
				title: "临时",
				message: "会消失",
				duration: 2000,
			});

			expect(toasts().length).toBe(1);

			// After duration: leaving=true
			vi.advanceTimersByTime(2000);
			expect(toasts()[0].leaving).toBe(true);

			// After 300ms animation: removed
			vi.advanceTimersByTime(300);
			expect(toasts().length).toBe(0);
		});
	});

	// ── dismissToast ──

	describe("dismissToast", () => {
		it("sets leaving=true then removes after 300ms", () => {
			const id = showToast({
				type: "warning",
				title: "警告",
				message: "即将消失",
				duration: 5000,
			});

			dismissToast(id);
			expect(toasts()[0].leaving).toBe(true);
			expect(toasts().length).toBe(1);

			vi.advanceTimersByTime(300);
			expect(toasts().length).toBe(0);
		});

		it("dismissing nonexistent id does nothing", () => {
			showToast({
				type: "info",
				title: "存在",
				message: "这条在",
				duration: 5000,
			});

			dismissToast(999);
			expect(toasts()[0].leaving).toBe(false);
			expect(toasts().length).toBe(1);
		});

		it("dismissing already-leaving toast is idempotent", () => {
			const id = showToast({
				type: "info",
				title: "测试",
				message: "测试",
				duration: 5000,
			});

			dismissToast(id);
			dismissToast(id); // second call
			vi.advanceTimersByTime(300);
			expect(toasts().length).toBe(0);
		});
	});

	// ── dismissAll ──

	describe("dismissAll", () => {
		it("clears all toasts immediately", () => {
			showToast({ type: "info", title: "A", message: "a", duration: 5000 });
			showToast({ type: "info", title: "B", message: "b", duration: 5000 });
			showToast({ type: "info", title: "C", message: "c", duration: 5000 });

			dismissAll();
			expect(toasts().length).toBe(0);
		});

		it("dismissAll clears even during leave animation", () => {
			const id = showToast({
				type: "info",
				title: "测试",
				message: "测试",
				duration: 5000,
			});

			dismissToast(id);
			expect(toasts()[0].leaving).toBe(true);

			dismissAll();
			expect(toasts().length).toBe(0);
		});
	});

	// ── max 5 toasts ──

	describe("max 5", () => {
		it("keeps only last 5 toasts", () => {
			for (let i = 0; i < 7; i++) {
				showToast({
					type: "info",
					title: `Toast ${i}`,
					message: `消息 ${i}`,
					duration: 5000,
				});
			}

			expect(toasts().length).toBe(5);
			// Oldest (0, 1) removed; 2-6 kept
			expect(toasts()[0].title).toBe("Toast 2");
			expect(toasts()[4].title).toBe("Toast 6");
		});

		it("5 toasts exact is fine", () => {
			for (let i = 0; i < 5; i++) {
				showToast({
					type: "info",
					title: `Toast ${i}`,
					message: `msg`,
					duration: 5000,
				});
			}

			expect(toasts().length).toBe(5);
		});
	});
});
