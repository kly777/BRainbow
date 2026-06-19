import { createSignal } from "solid-js";

// ==================== Types ====================

export type ToastType = "error" | "warning" | "success" | "info";

export interface ToastItem {
	id: number;
	type: ToastType;
	title: string;
	message: string;
	/** 可选：错误码或额外详情 */
	details?: string;
	/** 自动消失的毫秒数，0 表示不自动消失 */
	duration: number;
	/** 是否正在离开（动画用） */
	leaving: boolean;
}

// ==================== Global State ====================

const [toasts, setToasts] = createSignal<ToastItem[]>([]);
let nextId = 1;
const DEFAULT_DURATION = 5000; // 5秒

// ==================== Public API ====================

/**
 * 弹出一个 Toast 通知。
 * 返回 toast id，可用于手动关闭。
 */
export function showToast(item: Omit<ToastItem, "id" | "leaving">): number {
	const id = nextId++;
	const toast: ToastItem = {
		...item,
		id,
		leaving: false,
		duration: item.duration ?? DEFAULT_DURATION,
	};

	setToasts((prev) => [...prev, toast]);

	// 自动消失
	if (toast.duration > 0) {
		setTimeout(() => dismissToast(id), toast.duration);
	}

	// 最多保留 5 条
	setToasts((prev) => {
		if (prev.length > 5) {
			return prev.slice(prev.length - 5);
		}
		return prev;
	});

	return id;
}

/**
 * 手动关闭一条 toast（带动画）。
 */
export function dismissToast(id: number): void {
	setToasts((prev) =>
		prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)),
	);

	// 动画结束后真正移除
	setTimeout(() => {
		setToasts((prev) => prev.filter((t) => t.id !== id));
	}, 300);
}

/**
 * 关闭所有 toast。
 */
export function dismissAll(): void {
	setToasts([]);
}

export { toasts };
