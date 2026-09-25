// ── safe-action 安全异步操作（测试覆盖扩充）──
// mock 掉 toast 与确认框，专注验证分支语义。

import { beforeEach, describe, expect, it, vi } from "vitest";
import { notifyError } from "./notify.ts";
import { confirmAndRun, showConfirm, tryOrNotify } from "./safe-action.ts";

vi.mock("./notify.ts", () => ({ notifyError: vi.fn() }));
vi.mock("./confirmStore.ts", () => ({
	showConfirm: vi.fn(),
}));

const mockedNotify = vi.mocked(notifyError);
const mockedConfirm = vi.mocked(showConfirm);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("tryOrNotify", () => {
	it("成功时返回数据且不通知", async () => {
		const out = await tryOrNotify(async () => 42, "加载");
		expect(out).toBe(42);
		expect(mockedNotify).not.toHaveBeenCalled();
	});

	it("失败时返回 null 并以「context失败」通知，错误透传", async () => {
		const boom = new Error("网络断开");
		const out = await tryOrNotify(async () => {
			throw boom;
		}, "删除卡片");
		expect(out).toBeNull();
		expect(mockedNotify).toHaveBeenCalledOnce();
		expect(mockedNotify).toHaveBeenCalledWith("删除卡片失败", boom);
	});
});

describe("confirmAndRun", () => {
	it("用户取消时不执行操作直接返回 false", async () => {
		mockedConfirm.mockResolvedValue(false);
		const fn = vi.fn(async () => 1);
		const out = await confirmAndRun(
			{ title: "删除", message: "确定？" },
			fn,
			"删除",
		);
		expect(out).toBe(false);
		expect(fn).not.toHaveBeenCalled();
		expect(mockedNotify).not.toHaveBeenCalled();
	});

	it("确认且成功返回 true", async () => {
		mockedConfirm.mockResolvedValue(true);
		const fn = vi.fn(async () => 1);
		const out = await confirmAndRun(
			{ title: "删除", message: "确定？" },
			fn,
			"删除",
		);
		expect(out).toBe(true);
		expect(fn).toHaveBeenCalledOnce();
	});

	it("确认但失败返回 false 并通知", async () => {
		mockedConfirm.mockResolvedValue(true);
		const boom = new Error("外键约束");
		const out = await confirmAndRun(
			{ title: "删除", message: "确定？" },
			async () => {
				throw boom;
			},
			"删除任务",
		);
		expect(out).toBe(false);
		expect(mockedNotify).toHaveBeenCalledWith("删除任务失败", boom);
	});
});
