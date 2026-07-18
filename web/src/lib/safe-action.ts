/**
 * 安全异步操作工具
 *
 * 提供 tryOrNotify 和 withConfirm 两个辅助函数，
 * 减少组件中重复的 try/catch + toast 样板代码。
 *
 * 用法：
 *   import { tryOrNotify, withConfirm, showConfirm } from "@/lib/safe-action";
 *
 *   // 仅通知错误
 *   await tryOrNotify(() => deleteItem(id), "删除");
 *
 *   // 确认 + 通知
 *   const ok = await showConfirm({ title: "删除", message: "确定？", variant: "danger" });
 *   if (!ok) return;
 *   await tryOrNotify(() => deleteItem(id), "删除");
 */

import type { ConfirmOptions } from "../components/ui/confirmStore.ts";
import { showConfirm as show } from "../components/ui/confirmStore.ts";
import { notifyError } from "./notify.ts";

// Re-export for convenience
export { show as showConfirm };

/**
 * 执行异步函数，失败时自动调用 notifyError。
 *
 * @param fn - 异步函数
 * @param context - 操作名称（如 "删除"、"保存"），用于生成错误标题
 * @returns true 表示成功，false 表示失败（已通知用户）
 *
 * @example
 *   const ok = await tryOrNotify(() => deleteCard(id), "删除卡片");
 *   if (!ok) return;
 *   // 继续后续操作（如刷新列表）
 */
export async function tryOrNotify(
	fn: () => Promise<unknown>,
	context: string,
): Promise<boolean> {
	try {
		await fn();
		return true;
	} catch (e: unknown) {
		notifyError(`${context}失败`, e);
		return false;
	}
}

/**
 * 带确认的异步操作：先弹确认框，用户确认后再执行。
 * 失败时自动调用 notifyError。
 *
 * @param confirmOptions - 确认对话框配置
 * @param fn - 异步函数
 * @param context - 操作名称（如 "删除"、"重置"）
 * @returns true 表示用户确认且操作成功，false 表示用户取消或操作失败
 *
 * @example
 *   const ok = await confirmAndRun(
 *     { title: "删除卡片", message: "确定删除？此操作不可撤销。", variant: "danger" },
 *     () => deleteCard(id),
 *     "删除卡片",
 *   );
 */
export async function confirmAndRun(
	confirmOptions: ConfirmOptions,
	fn: () => Promise<unknown>,
	context: string,
): Promise<boolean> {
	const confirmed = await show(confirmOptions);
	if (!confirmed) return false;
	return tryOrNotify(fn, context);
}
