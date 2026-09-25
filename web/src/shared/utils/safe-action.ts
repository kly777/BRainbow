/**
 * 安全异步操作工具
 *
 * 基于 Result<T, E> 类型的高层封装，提供：
 * - tryOrNotify: 执行异步操作，失败时自动 toast 通知用户
 * - confirmAndRun: 确认对话框 + 执行 + 错误通知
 * - showConfirm: 弹出确认对话框（re-export）
 *
 * 用法：
 *   import { tryOrNotify, confirmAndRun, showConfirm } from "@shared/utils";
 *
 *   // 仅通知错误，成功后拿到返回值
 *   const card = await tryOrNotify(() => createCard(req), "创建卡片");
 *   if (card) navigate(fillPath(PATHS.cardDetail, card.id)); // 路径来自 @config/paths
 *
 *   // 确认 + 通知
 *   const ok = await confirmAndRun(
 *     { title: "删除", message: "确定？", variant: "danger" },
 *     () => deleteCard(id),
 *     "删除卡片",
 *   );
 */

import type { ConfirmOptions } from "./confirmStore.ts";
import { showConfirm as show } from "./confirmStore.ts";
import { notifyError, notifySuccess } from "./notify.ts";
import { tryAsync } from "./result.ts";

export {
	err,
	flatMap,
	map,
	match,
	ok,
	tryAsync,
	unwrapOr,
} from "./result.ts";
// Re-export 以便统一导入
export { show as showConfirm };

/**
 * 执行异步函数，失败时自动调用 notifyError。
 * 比 tryAsync 更进一步：自动把技术错误翻译为用户可见的 toast。
 *
 * @param fn - 异步函数
 * @param context - 操作名称（如 "删除"、"保存"），用于生成错误标题
 * @returns 成功时返回数据，失败时返回 null（已通知用户）
 *
 * @example
 *   const card = await tryOrNotify(() => createCardE(req), "创建卡片");
 *   if (card) navigate(fillPath(PATHS.cardDetail, card.id)); // 路径来自 @config/paths
 */
export async function tryOrNotify<T>(
	fn: () => Promise<T>,
	context: string,
): Promise<T | null> {
	const result = await tryAsync(fn);
	if (result.ok) return result.value;
	notifyError(`${context}失败`, result.error);
	return null;
}

/**
 * 带确认的异步操作：先弹确认框，用户确认后再执行。
 * 失败时自动调用 notifyError。
 *
 * @param confirmOptions - 确认对话框配置
 * @param fn - 异步函数
 * @param context - 操作名称（如 "删除"、"重置"）
 * @returns true 表示用户确认且操作成功，false 表示用户取消或操作失败
 */
export async function confirmAndRun<T>(
	confirmOptions: ConfirmOptions,
	fn: () => Promise<T>,
	context: string,
): Promise<boolean> {
	const confirmed = await show(confirmOptions);
	if (!confirmed) return false;
	const result = await tryAsync(fn);
	if (result.ok) return true;
	notifyError(`${context}失败`, result.error);
	return false;
}

/**
 * 确认删除辅助：统一 confirm → delete → notify → callback 模式。
 *
 * 覆盖最常见的删除场景：
 * - 简单删除（confirm → delete → navigate/refetch）
 * - 乐观删除（调用方先移除 UI 项，再调此函数；失败时 onError 回滚）
 *
 * @param opts.title - 确认框标题（如 "删除卡片"）
 * @param opts.message - 确认框消息
 * @param opts.confirmLabel - 确认按钮文案（默认 "删除"）
 * @param opts.deleteFn - 实际删除 API 调用
 * @param opts.successMessage - 成功 toast 消息（可选，不传则不弹成功 toast）
 * @param opts.onSuccess - 成功后回调（navigate / refetch / 清理状态等）
 * @param opts.onError - 失败后回调（乐观回滚 / refetch 等；错误 toast 已自动处理）
 * @returns true = 用户确认且删除成功；false = 取消或失败
 */
export async function confirmAndDelete(opts: {
	title: string;
	message: string;
	confirmLabel?: string;
	deleteFn: () => Promise<unknown>;
	successMessage?: string;
	onSuccess?: () => void;
	onError?: () => void;
}): Promise<boolean> {
	const confirmed = await show({
		title: opts.title,
		message: opts.message,
		variant: "danger",
		confirmLabel: opts.confirmLabel ?? "删除",
	});
	if (!confirmed) return false;

	const result = await tryAsync(opts.deleteFn);
	if (!result.ok) {
		notifyError(`${opts.title}失败`, result.error);
		opts.onError?.();
		return false;
	}

	if (opts.successMessage) notifySuccess(opts.successMessage);
	opts.onSuccess?.();
	return true;
}
