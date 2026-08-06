/**
 * 全局确认对话框状态管理
 *
 * 提供命令式 API：await showConfirm({ title, message, variant })
 * 类似 toastStore 的模式 —— 全局信号 + Container 组件渲染
 *
 * 用法：
 *   import { showConfirm } from "@components/ui/confirmStore";
 *   const ok = await showConfirm({ title: "删除", message: "确定？", variant: "danger" });
 *   if (!ok) return;
 */

import { createSignal } from "solid-js";

// ==================== Types ====================

export type ConfirmVariant = "danger" | "warning" | "info";

export interface ConfirmOptions {
	title: string;
	message: string;
	variant?: ConfirmVariant;
	confirmLabel?: string;
	cancelLabel?: string;
}

interface ConfirmItem {
	id: number;
	options: ConfirmOptions;
	resolve: (value: boolean) => void;
}

// ==================== Global State ====================

const [items, setItems] = createSignal<ConfirmItem[]>([]);
let nextId = 1;

// ==================== Public API ====================

/**
 * 弹出确认对话框，返回 Promise<boolean>。
 * 用户点击"确认" → resolve(true)，点击"取消"或按 Escape → resolve(false)。
 *
 * 注意：wrappedResolve 必须在放入信号数组**之前**构造好——
 * Solid 的信号更新会同步触发 ConfirmDialog 渲染，组件在渲染时解构
 * resolve；若之后再替换 item.resolve，组件会持有无清理逻辑的旧引用，
 * 点击按钮后 Promise 虽被 resolve，但对话框不会从列表移除。
 */
export function showConfirm(options: ConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const id = nextId++;

		const wrappedResolve = (value: boolean) => {
			// 无论 resolve 与否，先从列表移除
			setItems((prev) => prev.filter((i) => i.id !== id));
			resolve(value);
		};

		setItems((prev) => [...prev, { id, options, resolve: wrappedResolve }]);
	});
}

/**
 * 关闭所有确认对话框（用于路由切换等场景）
 */
export function dismissAllConfirms(): void {
	for (const item of items()) {
		item.resolve(false);
	}
	setItems([]);
}

export { items as confirms };
