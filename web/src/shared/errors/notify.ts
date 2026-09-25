// ── 统一用户通知模块 ──
// 封装 toastStore.showToast，提供简洁的业务层 API。
// 住在 shared/errors/ 而不是 shared/utils/：它与"错误 → 文案 → 提示"是同一件事，
// 见 doc/error-handling.md。

import { showToast } from "../utils/toastStore.ts";
import { getErrorMessage, HttpError } from "./model.ts";

/**
 * 这个错误是不是**传输层已经替我们说过了**？
 *
 * `request()` / `streaming` 的 handleGlobalError 对 401（弹登录框 + 一条提示）、
 * 403（"权限不足"）、5xx（"服务器错误"）已经各弹过一次；组件再弹一条"XX失败：<同一句
 * 原因>"就是两条几乎一样的提示。所以这几种 HttpError 在组件层静默。
 *
 * 两条边界要记住：
 *  · `NetworkError` **不**在内 —— 它不经过 handleGlobalError（那个只认 HttpError），
 *    网络断了正是最该说话的时候；
 *  · 要保留动作语境（"删除失败"而不只是"服务器错误"）就不传 error：
 *    `notifyError("删除失败")`，文案自己给。
 */
function alreadyReported(error: unknown): boolean {
	return (
		error instanceof HttpError &&
		(error.status === 401 || error.status === 403 || error.status >= 500)
	);
}

/**
 * 显示错误通知（带可选的原始 error 对象提取详情）。
 * 401/403/5xx 静默 —— 见 `alreadyReported`。
 */
export function notifyError(title: string, error?: unknown): void {
	if (alreadyReported(error)) return;

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
