import { HttpError, NetworkError } from "@shared/api";
import { describe, expect, it, vi } from "vitest";

vi.mock("./toastStore.ts", () => ({
	showToast: vi.fn(),
}));

/** 取一份干净的 mock（每个用例独立） */
async function setup() {
	const { showToast } = await import("./toastStore.ts");
	const { notifyError } = await import("./notify.ts");
	const mockShowToast = vi.mocked(showToast);
	mockShowToast.mockClear();
	return { mockShowToast, notifyError };
}

describe("notifyError 的抑制规则（已由传输层提示过的不再重复）", () => {
	// 全局层（request.ts / streaming.ts 的 handleGlobalError）对这几种各弹过一次：
	// 401 弹登录框 + 一条提示、403 "权限不足"、5xx "服务器错误"。组件再弹就是两条
	// 几乎一样的提示。口径写在 notify.ts 的 alreadyReported。
	for (const [status, label] of [
		[401, "未登录"],
		[403, "无权限"],
		[500, "服务端错误"],
		[502, "网关错误"],
		[503, "暂停服务"],
	] as const) {
		it(`${status}（${label}）静默`, async () => {
			const { mockShowToast, notifyError } = await setup();
			notifyError(
				"保存失败",
				new HttpError({ status, code: `HTTP_${status}`, message: "x" }),
			);
			expect(mockShowToast).not.toHaveBeenCalled();
		});
	}

	it("4xx 业务错误照常弹（全局层对 4xx 只打日志，不弹）", async () => {
		const { mockShowToast, notifyError } = await setup();
		notifyError(
			"保存失败",
			new HttpError({ status: 409, code: "CONFLICT", message: "名字重复" }),
		);
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "保存失败",
				message: "名字重复",
				details: "CONFLICT",
			}),
		);
	});

	it("NetworkError 照常弹（它不经过 handleGlobalError，网络断了必须说）", async () => {
		const { mockShowToast, notifyError } = await setup();
		notifyError("保存失败", new NetworkError({ cause: "fetch failed" }));
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "保存失败",
				message: "网络连接失败，请检查网络",
			}),
		);
	});

	it("不传 error 时照常弹（要动作语境就用这个写法）", async () => {
		const { mockShowToast, notifyError } = await setup();
		notifyError("保存失败");
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "保存失败",
				message: "",
			}),
		);
	});

	it("非 Error 的未知值也照常弹，不带 details", async () => {
		const { mockShowToast, notifyError } = await setup();
		notifyError("保存失败", { weird: true });
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "保存失败",
				message: "未知错误",
				details: undefined,
			}),
		);
	});
});

describe("notifySuccess / notifyWarning / notifyInfo", () => {
	it("notifySuccess 弹成功 toast", async () => {
		const { showToast } = await import("./toastStore.ts");
		const { notifySuccess } = await import("./notify.ts");
		const mockShowToast = vi.mocked(showToast);
		mockShowToast.mockClear();

		notifySuccess("操作成功", "已保存");
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				title: "操作成功",
				message: "已保存",
			}),
		);
	});

	it("notifySuccess 默认空消息", async () => {
		const { showToast } = await import("./toastStore.ts");
		const { notifySuccess } = await import("./notify.ts");
		const mockShowToast = vi.mocked(showToast);
		mockShowToast.mockClear();

		notifySuccess("完成");
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "success",
				title: "完成",
				message: "",
			}),
		);
	});
});
