// ── 缓存域注册表：失效策略的唯一来源 ──
//
// 收敛点（替代 resource()）：
//   domains.cards.invalidate(writePromise)
// 每个域声明：
//   reads        — 本域缓存的读取键模式（命中即视为本域缓存）
//   invalidates  — 写入本域时连带失效的其他域（跨域依赖）
// 写入方只需声明"动了哪个域"，清哪些读键由本表决定。
//
// 修剪记录
//   - mem: 读取全部走 request（不经缓存），写入无需失效仪式（删除）
//   - sign: 前端无 sign 模块，无消费者（删除）

import { invalidateCache } from "./cache.ts";

/** 读取键前缀模式，按 API 域划分（键名即域名字面量，单一来源） */
export const CACHE = {
	cards: /^GET \/cards/,
	bookmarks: /^GET \/bookmarks/,
	tasks: /^GET \/tasks/,
	db: /^GET \/db/,
	onto: /^GET \/onto/,
	text: /^GET \/text/,
	timeWindows: /^GET \/time-windows/,
	media: /^GET \/media/,
} as const;

export type DomainName = keyof typeof CACHE;

export interface DomainDef {
	/** 本域缓存的读取键模式（命中即视为本域缓存） */
	readonly reads: readonly RegExp[];
	/** 写入本域时连带失效的其他域（跨域依赖） */
	readonly invalidates?: readonly DomainName[];
}

export const DOMAIN_DEFS: Record<DomainName, DomainDef> = {
	cards: { reads: [CACHE.cards] },
	bookmarks: { reads: [CACHE.bookmarks] },
	tasks: { reads: [CACHE.tasks], invalidates: ["timeWindows"] },
	db: { reads: [CACHE.db] },
	onto: { reads: [CACHE.onto] },
	text: { reads: [CACHE.text] },
	timeWindows: { reads: [CACHE.timeWindows] },
	media: { reads: [CACHE.media] },
};

export interface CacheResource {
	/**
	 * 包装写操作 Promise，成功后自动失效本域（及连带域）缓存。
	 * @example
	 *   domains.tasks.invalidate(post("/tasks", req));
	 */
	invalidate<T>(promise: Promise<T>): Promise<T>;
}

/** 本域 + 连带域的全部失效模式 */
function patternsFor(domain: DomainName): readonly RegExp[] {
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
		const patterns = patternsFor(domain);
		return [
			domain,
			{
				invalidate<T>(promise: Promise<T>): Promise<T> {
					return promise.then((result) => {
						for (const p of patterns) invalidateCache(p);
						return result;
					});
				},
			},
		];
	}),
) as Record<DomainName, CacheResource>;
