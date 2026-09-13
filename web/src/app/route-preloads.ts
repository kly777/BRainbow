/**
 * 路由级数据预取（阶段 6）
 *
 * 机制（读的是 @solidjs/router 0.16 的实现，不是猜的）：
 *   `A` 触发的 mousemove / 预取意图事件会调用 `router.preloadRoute(url, preloadData)`，
 *   其中 `preloadData` 默认就是 **true**（除非链接上写了 `preload="false"`）；
 *   它会先跑 `route.component.preload()`（懒加载 chunk），再跑路由定义里的 `preload({params, location, intent})`。
 *   于是"鼠标移到列表项上"就会把详情数据取进 `shared/api/cache.ts`，
 *   点击时页面的 `createResource` 命中缓存（30s TTL + 单一飞行），骨架屏一闪而过甚至看不见。
 *
 * 三条必须遵守的约束：
 * 1. **绝不抛错**：路由器不 await 也不 catch 这个返回值（routing.js 里是裸调用），
 *    一旦拒绝就是未处理的 Promise 拒绝 —— 本仓库在 P1-5 上踩过同一类坑。
 *    所以这里统一包一层 try/catch，失败就当作没预取，页面自己的错误态照旧。
 * 2. **只取"页面一定会用同样的参数再取一次"的数据**：key 要与页面调用完全一致，
 *    否则预取只是白花一次请求（缓存键由 endpoint + 排序后的查询参数决定）。
 * 3. **用动态 import**：这些 api 模块不能因此进入首屏同步链（PAGE_LOADERS 同样是懒加载）。
 */

import { PATHS, type PathValue } from "@config/paths";
import type { Params, RoutePreloadFuncArgs } from "@solidjs/router";

type PreloadArgs = Pick<RoutePreloadFuncArgs, "params" | "location">;
type Preload = (args: PreloadArgs) => Promise<void>;

/**
 * 只在链接预取意图（悬停 / focus 之类）时取数。
 *
 * 导航时与初始加载时**不做**：那一刻路由上下文刚建立、页面组件的 createResource
 * 紧接着就发同一请求（缓存键相同，单一飞行会合并），预取拿不到任何时间优势，
 * 反而要多付一次动态 import 的往返。intent 由路由器传入（initial / native / navigate / preload）。
 */
export function shouldPrefetch(
	intent: RoutePreloadFuncArgs["intent"],
): boolean {
	return intent === "preload";
}

/** 解析数字 id：不是正整数就不预取（把"无效 ID"的判定留给页面自己的错误态） */
function numericId(params: Readonly<Params>): number | undefined {
	const raw = params.id;
	if (!raw || !/^\d+$/.test(raw)) return undefined;
	const n = Number(raw);
	return Number.isInteger(n) && n >= 1 ? n : undefined;
}

/** 预取失败一律吞掉：路由器的这个调用点是裸调用，拒绝会变成未处理拒绝 */
async function quietly(run: () => Promise<unknown>): Promise<void> {
	try {
		await run();
	} catch {
		// 预取失败不影响导航：页面自己的 AsyncView / ErrorRetry 会处理
	}
}

/**
 * 路径 → 预取函数。
 * 只覆盖"页面用同一个 id 单次取数"的详情页；多请求页（阅读详情要文章 + 生词 + 笔记）
 * 和需要额外查询参数的页（对话概念要 ?article=）暂不纳入 —— 预取它们要么请求翻倍，
 * 要么得复刻页面的参数拼装，收益不抵复杂度（见 doc 阶段 6 记录）。
 */
export const PAGE_PRELOADS: Partial<Record<PathValue, Preload>> = {
	[PATHS.cardDetail]: ({ params }) => {
		const id = numericId(params);
		if (id === undefined) return Promise.resolve();
		return quietly(async () => {
			const { getCardE } = await import("@modules/card/api.ts");
			await getCardE(id);
		});
	},
	[PATHS.ontologyDetail]: ({ params }) => {
		const id = numericId(params);
		if (id === undefined) return Promise.resolve();
		return quietly(async () => {
			const { getOntoE } = await import("@modules/ontology/api.ts");
			await getOntoE(id);
		});
	},
	[PATHS.bookmarkDetail]: ({ params }) => {
		const id = numericId(params);
		if (id === undefined) return Promise.resolve();
		return quietly(async () => {
			const { getBookmarkE } = await import("@modules/bookmark/api.ts");
			await getBookmarkE(id);
		});
	},
	[PATHS.taskDetail]: ({ params }) => {
		const id = numericId(params);
		if (id === undefined) return Promise.resolve();
		return quietly(async () => {
			const { getTaskDetailE } = await import("@modules/task/api.ts");
			await getTaskDetailE(id);
		});
	},
	[PATHS.convDetail]: ({ params }) => {
		const id = numericId(params);
		if (id === undefined) return Promise.resolve();
		return quietly(async () => {
			const { getConvDetailE } = await import("@modules/conv/api.ts");
			await getConvDetailE(id);
		});
	},
	// 文件详情用的是 stored_id（字符串，不是数字 id）
	[PATHS.fileDetail]: ({ params }) => {
		const storedId = params.id;
		if (!storedId) return Promise.resolve();
		return quietly(async () => {
			const { getFile } = await import("@modules/file/api.ts");
			await getFile(storedId);
		});
	},
};
