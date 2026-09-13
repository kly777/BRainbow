// ── 详情页数据源：单个实体的取数 + 四态 + "首次加载 / 后台刷新"的区分 ──
//
// 背景（doc/frontend-ui-architecture.md §4 P1-5、P1-6，§11.1/§11.2）：
// 详情页此前各自手写 `createResource` + tryAsync + 错误信号，踩过同一类坑三次：
//   1. fetcher 里 `throw` 或放任 promise 拒绝 → loading 永远停在 true，页面卡骨架屏；
//   2. 错误只用一个信号、无效 id 与请求失败各写一套 → 有的页面错误态根本到不了；
//   3. `loading` 在"后台刷新"时也为 true，而 resource 仍保留旧值 → 页面若照旧渲染骨架，
//      骨架会插在旧内容上方把整块内容顶下去（/file/:id "沉一下"就是这么来的）。
//
// 本 hook 把 1、2 收成一处，并用**两个命名明确的状态**解决 3：
//   - `loading`     ：还没有任何数据（首次加载）—— 只有它该渲染骨架；
//   - `refreshing`  ：有数据、正在更新 —— 保留旧内容，只做 busy 提示（布局不动）。
//
// 返回的字段一律是 **Accessor**（§11.1）：会变的值必须显式 `x()` 读取，
// 类型层面挡住"建对象那刻取值并冻结"的写法（`{ loading: res.loading }`）。

import { tryAsync } from "@shared/utils/result.ts";
import {
	type Accessor,
	createResource,
	createSignal,
	type Resource,
	type Setter,
} from "solid-js";

export interface DetailResourceOptions<T, I> {
	/**
	 * 实体 id（通常来自路由参数）。可直接给 `() => Number(params.id)` 这类表达式；
	 * 是否合法由 `validate` 判断 —— 非法时不发请求，错误走 `error()`。
	 */
	id: Accessor<I>;
	/** 校验 id；返回 false 视为"无效 ID"（不请求） */
	validate?: (id: I) => boolean;
	/** 取数函数。**不要在里面 throw**：抛错与拒绝都会被本 hook 消化成 `error()` */
	fetcher: (id: I) => Promise<T>;
	/** 无效 id 时暴露的错误对象（页面据此显示自己的文案） */
	invalidIdError?: unknown;
	/** 取数成功的回调（如滚动位置恢复）；失败不调用 */
	onLoaded?: (data: T) => void;
}

export interface DetailResource<T> {
	/** 数据；首次加载中与失败时为 undefined */
	data: Accessor<T | undefined>;
	/** 还没有任何数据（首次加载）—— 骨架屏只该看这个 */
	loading: Accessor<boolean>;
	/** 有数据、正在后台更新 —— 保留旧内容 + busy 提示，不要渲染骨架 */
	refreshing: Accessor<boolean>;
	/** 错误（无效 id 或请求失败），正常时为 undefined */
	error: Accessor<unknown>;
	/** 底层 resource（需要读 loading/refetching 等细节时用） */
	resource: Resource<T | undefined>;
	refetch: () => void;
	/** 直接改写本地数据（详情页乐观更新用；不校验服务端结果） */
	mutate: Setter<T | undefined>;
}

const DEFAULT_INVALID_ID_ERROR = new Error("无效的 ID");

export function useDetailResource<T, I>(
	options: DetailResourceOptions<T, I>,
): DetailResource<T> {
	const [loadError, setLoadError] = createSignal<unknown>(null);
	const valid = (id: I) => (options.validate ? options.validate(id) : true);

	const [resource, { refetch, mutate }] = createResource(
		options.id,
		async (id): Promise<T | undefined> => {
			if (!valid(id)) {
				// 同步失败路径：不 await，错误状态在首帧就绪（避免闪一下骨架）
				setLoadError(options.invalidIdError ?? DEFAULT_INVALID_ID_ERROR);
				return undefined;
			}
			const result = await tryAsync(() => options.fetcher(id));
			if (result.ok) {
				setLoadError(null);
				options.onLoaded?.(result.value);
				return result.value;
			}
			// 取数失败同样走错误信号：放任 Promise 拒绝会让页面既无错误态也无数据
			setLoadError(result.error);
			return undefined;
		},
	);

	// 关键不变量：**有错误时绝不为 loading**。
	// 否则"先判 loading"的渲染（AsyncView / AsyncSection 都是这么写的）会把已到的错误
	// 挡在骨架屏后面 —— 正是 P1-5 "页面永远卡在骨架屏"的成因。
	// 另外，后台刷新时 resource.loading 为真但数据还在：那种情况属于 refreshing，
	// 骨架条件（loading）必须为假，否则骨架会插在旧内容上方把内容顶下去。
	const loading = () =>
		resource.loading && resource() === undefined && loadError() === null;
	const refreshing = () => resource.loading && resource() !== undefined;

	return {
		data: () => resource(),
		loading,
		refreshing,
		error: () => loadError() ?? undefined,
		resource,
		refetch,
		mutate,
	};
}
