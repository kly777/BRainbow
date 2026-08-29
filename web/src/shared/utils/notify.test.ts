import { describe, expect, it, vi } from "vitest";
import { HttpError } from "@shared/api";

vi.mock("@components/ui/organisms/toastStore.ts", () => ({
	showToast: vi.fn(),
}));

describe("notify", () => {
	it("notifyError 401 静默（不弹 toast）", async () => {
		const { showToast } = await import(
			"@components/ui/organisms/toastStore.ts"
		);
		const { notifyError } = await import("./notify.ts");
		const mockShowToast = vi.mocked(showToast);

		const err401 = new HttpError({
			status: 401,
			code: "UNAUTHORIZED",
			message: "请先登录",
		});

		notifyError("失败", err401);
		expect(mockShowToast).not.toHaveBeenCalled();
	});

	it("notifyError 非401 弹 toast", async () => {
		const { showToast } = await import(
			"@components/ui/organisms/toastStore.ts"
		);
		const { notifyError } = await import("./notify.ts");
		const mockShowToast = vi.mocked(showToast);
		mockShowToast.mockClear();

		const err500 = new HttpError({
			status: 500,
			code: "INTERNAL",
			message: "服务器错误",
		});

		notifyError("失败", err500);
		expect(mockShowToast).toHaveBeenCalledTimes(1);
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "失败",
				message: "服务器错误",
			}),
		);
	});

	it("notifyError 无 error 参数弹空消息 toast", async () => {
		const { showToast } = await import(
			"@components/ui/organisms/toastStore.ts"
		);
		const { notifyError } = await import("./notify.ts");
		const mockShowToast = vi.mocked(showToast);
		mockShowToast.mockClear();

		notifyError("出错了");
		expect(mockShowToast).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "error",
				title: "出错了",
				message: "",
			}),
		);
	});

	it("notifySuccess 弹成功 toast", async () => {
		const { showToast } = await import(
			"@components/ui/organisms/toastStore.ts"
		);
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
		const { showToast } = await import(
			"@components/ui/organisms/toastStore.ts"
		);
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
