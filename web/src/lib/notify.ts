// ── 统一用户通知模块 ──
// 封装 toastStore.showToast，提供简洁的业务层 API

import { showToast } from "../components/ui/toastStore.ts";
import { getErrorMessage } from "../apis/types/errors.ts";

/** 显示错误通知（带可选的原始 error 对象提取详情） */
export function notifyError(title: string, error?: unknown): void {
	showToast({
		type: "error",
		title,
		message: error ? getErrorMessage(error) : "",
		details:
			error && typeof error === "object" && "code" in (error as object)
				? String((error as { code: string }).code)
				: undefined,
		duration: 6000,
	});
}

/** 显示成功通知 */
export function notifySuccess(title: string, message = ""): void {
	showToast({
		type: "success",
		title,
		message,
		duration: 3000,
	});
}

/** 显示警告通知 */
export function notifyWarning(title: string, error?: unknown): void {
	showToast({
		type: "warning",
		title,
		message: error ? getErrorMessage(error) : "",
		duration: 5000,
	});
}

/** 显示信息通知 */
export function notifyInfo(title: string, message = ""): void {
	showToast({
		type: "info",
		title,
		message,
		duration: 4000,
	});
}
