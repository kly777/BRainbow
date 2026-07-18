/**
 * 安全异步操作工具
 *
 * 基于 Result<T, E> 类型的高层封装，提供：
 * - tryOrNotify: 执行异步操作，失败时自动 toast 通知用户
 * - confirmAndRun: 确认对话框 + 执行 + 错误通知
 * - showConfirm: 弹出确认对话框（re-export）
 *
 * 用法：
 *   import { tryOrNotify, confirmAndRun, showConfirm } from "@/lib/safe-action";
 *
 *   // 仅通知错误，成功后拿到返回值
 *   const card = await tryOrNotify(() => createCard(req), "创建卡片");
 *   if (card) navigate(`/c/${card.id}`);
 *
 *   // 确认 + 通知
 *   const ok = await confirmAndRun(
 *     { title: "删除", message: "确定？", variant: "danger" },
 *     () => deleteCard(id),
 *     "删除卡片",
 *   );
 */

import { notifyError } from "./notify.ts";
import { tryAsync, type Result } from "./result.ts";
import { showConfirm as show } from "../components/ui/confirmStore.ts";
import type { ConfirmOptions } from "../components/ui/confirmStore.ts";

// Re-export 以便统一导入
export { show as showConfirm };
export {
	tryAsync,
	ok,
	err,
	map,
	flatMap,
	unwrapOr,
	match,
	type Result,
} from "./result.ts";

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
 *   if (card) navigate(`/c/${card.id}`);
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
