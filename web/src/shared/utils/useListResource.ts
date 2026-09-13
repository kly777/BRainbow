// ── 列表数据源：把"URL 参数 → 请求 → 分页 + 四态 + 乐观更新"收成一处 ──
//
// 背景（doc/frontend-ui-architecture.md P0-3）：改造前前端并存两套列表范式 ——
//   A) createResource + mutate（35 个文件，乐观更新的载体）
//   B) 手写 createSignal 管 data/page/totalPages/loading/error + 手搓 fetch
//      （如 useCardsList / useBookmarkPage，有的还自带 loadSeq 竞态守卫）
// 于是"列表该怎么做"没有唯一答案，下一个改这块的人会随机选一套。
//
// 本 hook 取 A 为唯一范式（createResource 自带竞态处理与 loading/error 状态，
// 无需手写 loadSeq），并把两派都在重复的乐观更新与回滚一并收进来。
//
// 两条必须遵守的约定（来自既有踩坑记录）：
//   1. `loading` / `error` 用 **getter** 而非值快照。写成 `loading: res.loading`
//      会在建对象那一刻取值并冻结，调用方永远看到初始的 true —— 这正是
//      "上传成功但列表为空"那个 bug 的成因。
//   2. 乐观更新失败时回滚到操作前的快照，而不是无条件 refetch：AsyncView 在
//      loading 时渲染骨架，整表重取会让列表闪一下。

import { getErrorMessage } from "@shared/api";
import { tryAsync } from "@shared/utils/result.ts";
import {
	type Accessor,
	createMemo,
	createResource,
	createSignal,
	type Resource,
} from "solid-js";

/** 后端统一分页响应（shared/pagination） */
export interface Paginated<T> {
	items: T[];
	page: number;
	total: number;
	total_pages: number;
}

export interface ListResourceOptions<K, T> {
	/**
	 * 请求键：其中任一字段变化即重新拉取。
	 * 用对象字面量即可（createResource 按引用比较，参数变化时自然重取）。
	 */
	key: () => K;
	/** 当前页码，通常来自 URL 参数 */
	page: Accessor<number>;
	fetcher: (key: K, page: number) => Promise<Paginated<T>>;
	/** 每次成功加载后回调（滚动位置恢复、统计同步等） */
	onLoaded?: (res: Paginated<T>) => void;
	/** 加载失败时回调（默认交给全局错误处理，无需重复 toast） */
	onError?: (message: string) => void;
}

export interface ListResource<T> {
	/** 底层 resource，需要时可直接 mutate */
	resource: Resource<Paginated<T>>;
	items: Accessor<T[]>;
	total: Accessor<number>;
	totalPages: Accessor<number>;
	/** 用 getter：见文件头约定 1 */
	readonly loading: boolean;
	readonly error: unknown;
	refetch: () => void;
	/** 直接替换本地列表（不校验请求结果） */
	patch: (updater: (items: T[]) => T[]) => void;
	/**
	 * 乐观执行写操作：
	 * 先按 `updater` 改本地列表，再执行 `action`；失败则回滚到操作前快照。
	 * 成功时不 refetch（避免骨架屏闪一下），失败时也不 refetch（快照已还原）。
	 */
	optimistic: <R>(
		updater: (items: T[]) => T[],
		action: () => Promise<R>,
	) => Promise<{ ok: true; value: R } | { ok: false; error: Error }>;
}

export function useListResource<K, T>(
	options: ListResourceOptions<K, T>,
): ListResource<T> {
	const EMPTY_PAGE: Paginated<T> = {
		items: [],
		page: 1,
		total: 0,
		total_pages: 0,
	};

	/** 错误单独用信号暴露，而不是让 fetcher 抛出去 —— 见下方注释 */
	const [error, setError] = createSignal<unknown>(null);

	const [resource, { refetch, mutate }] = createResource(
		() => ({ key: options.key(), page: options.page() }),
		async ({ key, page }) => {
			const result = await tryAsync(() => options.fetcher(key, page));
			if (result.ok) {
				setError(null);
				options.onLoaded?.(result.value);
				return result.value;
			}
			// ⚠ 刻意不 throw。
			// 从 fetcher 抛错会让 Solid 的响应式更新中断，而本应用**没有任何
			// ErrorBoundary**，结果是资源停在 loading=true —— AsyncView 永远
			// 显示骨架屏，错误态与重试入口都到不了（实测确认）。
			// 改为吞掉异常、返回空页，错误经 error 信号交给 AsyncView。
			setError(result.error);
			options.onError?.(getErrorMessage(result.error));
			return EMPTY_PAGE as Paginated<T>;
		},
	);

	const items = createMemo(
		() => resource()?.items ?? (EMPTY_PAGE.items as T[]),
	);
	const total = createMemo(() => resource()?.total ?? 0);
	const totalPages = createMemo(() => resource()?.total_pages ?? 0);

	const patch = (updater: (items: T[]) => T[]) => {
		mutate((prev) => {
			const base = prev ?? EMPTY_PAGE;
			return { ...base, items: updater(base.items) };
		});
	};

	const optimistic: ListResource<T>["optimistic"] = async (updater, action) => {
		const snapshot = items();
		patch(updater);
		const result = await tryAsync(action);
		if (!result.ok) patch(() => snapshot);
		return result;
	};

	return {
		resource,
		items,
		total,
		totalPages,
		get loading() {
			return resource.loading;
		},
		get error() {
			return error();
		},
		refetch,
		patch,
		optimistic,
	};
}
