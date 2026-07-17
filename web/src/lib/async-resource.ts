// ── 异步数据加载 hook：消除手动 loading / error 样板代码 ──

import { createSignal, onMount, type Signal } from "solid-js";
import { getErrorMessage } from "../apis/types/index.ts";
import { showToast } from "../components/ui/toastStore.ts";

/** useAsyncResource 的返回类型 */
export interface AsyncResource<T> {
	/** 当前数据（加载中时保留上次值） */
	readonly data: () => T | undefined;
	/** 是否正在加载 */
	readonly loading: () => boolean;
	/** 错误信息（null 表示无错误） */
	readonly error: () => string | null;
	/** 重新加载 */
	refetch: () => Promise<void>;
	/** 更新本地数据（乐观更新后可用） */
	setData: (v: T) => void;
	/** 将 loading 设为 true 并重新获取 */
	invalidate: () => Promise<void>;
}

/**
 * 创建异步数据资源。
 *
 * 用法:
 * ```ts
 * const todos = useAsyncResource(() => getTodos());
 * // 在 JSX 中:
 * <Show when={todos.loading()} fallback={<List items={todos.data() ?? []} />}>
 *   <Loading />
 * </Show>
 * ```
 *
 * @param fetcher - 返回 Promise<T> 的异步函数
 * @param options.onError - 错误回调（默认 toast）
 * @param options.initial - 初始值（默认 undefined）
 */
export function useAsyncResource<T>(
	fetcher: () => Promise<T>,
	options?: {
		onError?: (err: unknown) => void;
		initial?: T;
	},
): AsyncResource<T> {
	const [data, setData] = createSignal<T | undefined>(options?.initial);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);

	async function load() {
		setLoading(true);
		setError(null);
		try {
			const result = await fetcher();
			setData(() => result);
		} catch (err: unknown) {
			const msg = getErrorMessage(err);
			setError(msg);
			(options?.onError ?? defaultOnError)(err);
		} finally {
			setLoading(false);
		}
	}

	onMount(() => {
		load();
	});

	return {
		data,
		loading,
		error,
		refetch: load,
		setData,
		async invalidate() {
			await load();
		},
	};
}

function defaultOnError(err: unknown) {
	const msg = getErrorMessage(err);
	if (msg) {
		showToast({ type: "error", title: "加载失败", message: msg });
	}
}
