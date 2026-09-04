// ── 域读模式与陈旧时长：缓存策略的零依赖单一来源 ──
//
// 职责：
//   - CACHE           — 每域「宽匹配」读模式（用于解析端点归属域 → 陈旧时长；边界测试）
//   - DOMAIN_STALE_MS — 域级默认陈旧时长（缺省回退 DEFAULT_STALE_MS）
//   - resolveStaleMs  — 按缓存键解析陈旧时长：显式值优先，否则按端点匹配域默认
//
// 零依赖：cache.ts 与 domains.ts 都从这里取策略，避免两者互相 import 成环。

/** 域「宽匹配」读模式（键名即域名字面量，单一来源） */
export const CACHE = {
	cards: /^GET \/cards/,
	bookmarks: /^GET \/bookmarks/,
	tasks: /^GET \/tasks/,
	db: /^GET \/db/,
	onto: /^GET \/onto/,
	text: /^GET \/text/,
	timeWindows: /^GET \/time-windows/,
	media: /^GET \/media/,
	files: /^GET \/files/,
} as const;

export type DomainName = keyof typeof CACHE;

/** 默认陈旧时长：未声明域级策略的兜底 */
export const DEFAULT_STALE_MS = 30_000;

/**
 * 域级默认陈旧时长。
 * 策略依据：聚合/重算代价高、变化频率低的域留更久（修正"最贵查询刷新最频繁"的倒挂）。
 * 缺省不声明 = 用 DEFAULT_STALE_MS。
 */
export const DOMAIN_STALE_MS: Partial<Record<DomainName, number>> = {
	// 任务树/统计/详情重算代价高，留 60s
	tasks: 60_000,
	// 本体数据不常变，留 60s
	onto: 60_000,
};

/** 按缓存键解析陈旧时长：explicit 优先，否则匹配域默认，兜底 DEFAULT_STALE_MS */
export function resolveStaleMs(key: string, explicit?: number): number {
	if (explicit !== undefined) return explicit;
	for (const name of Object.keys(CACHE) as DomainName[]) {
		if (CACHE[name].test(key)) return DOMAIN_STALE_MS[name] ?? DEFAULT_STALE_MS;
	}
	return DEFAULT_STALE_MS;
}
