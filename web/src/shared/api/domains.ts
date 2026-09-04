// ── 缓存域注册表：失效策略的唯一来源 ──
//
// 收敛点（替代 resource()）：
//   domains.cards.invalidate(writePromise)
// 每个域声明：
//   reads        — 本域缓存「宽」读模式（写操作连坐失效：列表/聚合/搜索）
//   singles      — 单条实体读模式（仅在该实体被写时精确失效，不随任意写连坐）
//   invalidates  — 写入本域时连带失效的其他域（跨域依赖）
// 写入方只需声明"动了哪个域"，清哪些读键由本表决定。
//
// 修剪记录
//   - mem: 读取全部走 request（不经缓存），写入无需失效仪式（删除）
//   - sign: 前端无 sign 模块，无消费者（删除）

import { buildCacheKey, deleteCacheKey, invalidateCache } from "./cache.ts";
import type { DomainName } from "./domainPatterns.ts";

export { CACHE, type DomainName } from "./domainPatterns.ts";

export interface DomainDef {
	/** 写操作连坐失效的读取键模式（列表/聚合/搜索失效） */
	readonly reads: readonly RegExp[];
	/**
	 * 单条实体读模式：仅在该实体被写时精确失效，不随任意写连坐。
	 * 配合 invalidate(promise, { entity }) 使用。
	 */
	readonly singles?: readonly RegExp[];
	/** 写入本域时连带失效的其他域（跨域依赖） */
	readonly invalidates?: readonly DomainName[];
}

export const DOMAIN_DEFS: Record<DomainName, DomainDef> = {
	cards: {
		reads: [/^GET \/cards(?:\?|$)/, /^GET \/cards\/search/],
		singles: [/^GET \/cards\/\d+/],
	},
	bookmarks: {
		reads: [
			/^GET \/bookmarks(?:\?|$)/,
			/^GET \/bookmarks\/search/,
			/^GET \/bookmarks\/tags/,
			/^GET \/bookmarks\/grouped-by-tag/,
		],
		singles: [/^GET \/bookmarks\/\d+/],
	},
	tasks: {
		reads: [
			/^GET \/tasks(?:\?|$)/,
			/^GET \/tasks\/(?:search|tree|stats|user|status|all|dag|calendar)\b/,
		],
		singles: [/^GET \/tasks\/\d+/],
		invalidates: ["timeWindows"],
	},
	db: { reads: [/^GET \/db/] },
	onto: { reads: [/^GET \/onto(?:\?|$)/], singles: [/^GET \/onto\/\d+/] },
	text: { reads: [/^GET \/text/] },
	timeWindows: { reads: [/^GET \/time-windows(?:\?|$)/] },
	media: { reads: [/^GET \/media(?:\?|$)/], singles: [/^GET \/media\/[^?]+/] },
	files: {
		reads: [/^GET \/file(?:\?|$)/, /^GET \/file\/tags/],
		singles: [/^GET \/file\/[^?]+/],
	},
};

export interface CacheResource {
	/**
	 * 包装写操作 Promise，成功后自动失效本域（及连带域）缓存。
	 * @param promise - 写操作 Promise
	 * @param opts.entity - 被写实体的 API 路径（如 "/cards/5"）：精确清掉该实体单条缓存，
	 *                      避免连坐同域其他实体的单条缓存。
	 * @example
	 *   // 创建（无实体）→ 连坐清列表/搜索
	 *   domains.cards.invalidate(post("/cards", req));
	 *   // 更新（指定实体）→ 连坐清列表/搜索 + 精确清该实体单条
	 *   domains.cards.invalidate(patch("/cards/5", req), { entity: "/cards/5" });
	 */
	invalidate<T>(promise: Promise<T>, opts?: { entity?: string }): Promise<T>;
}

/** 本域「宽」读模式 + 连带域的全部失效模式 */
function broadPatternsFor(domain: DomainName): readonly RegExp[] {
	const def = DOMAIN_DEFS[domain];
	const patterns = [...def.reads];
	for (const other of def.invalidates ?? []) {
		patterns.push(...DOMAIN_DEFS[other].reads);
	}
	return patterns;
}

export const domains = Object.fromEntries(
	Object.keys(DOMAIN_DEFS).map((name) => {
		const domain = name as DomainName;
		const broadPatterns = broadPatternsFor(domain);
		return [
			domain,
			{
				invalidate<T>(
					promise: Promise<T>,
					opts?: { entity?: string },
				): Promise<T> {
					return promise.then((result) => {
						// 连坐清「宽」读模式（列表/聚合/搜索/跨域）
						for (const p of broadPatterns) invalidateCache(p);
						// 实体自身精确清（兜底：即使读模式变化也不漏）
						if (opts?.entity) {
							deleteCacheKey(buildCacheKey("GET", opts.entity));
						}
						return result;
					});
				},
			},
		];
	}),
) as Record<DomainName, CacheResource>;
