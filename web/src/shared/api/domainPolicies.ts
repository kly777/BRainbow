// ── 域缓存策略：失效模式与陈旧时长的唯一来源 ──
//
// 一个域一条策略，每个字段都有消费方（`resolveStaleMs` / `domains.ts` / `domainPolicies.test.ts`）：
//   reads       列表/聚合/搜索的读端点：写本域时整体失效，也参与陈旧时长解析
//   singles     单条实体读：不参与「写本域即失效」，只在写方给出 `{ entity }` 时按实体前缀清
//   invalidates 写本域时连带失效的其他域（跨域依赖，如 tasks → timeWindows）
//   staleMs     域级默认陈旧时长（缺省 DEFAULT_STALE_MS）
//
// **为什么只留这一张表**：早先失效模式（domains.ts 的 DOMAIN_DEFS）与陈旧时长（本文件的
// CACHE）是两张表，同一个域在两处的正则写法不同，于是各自漏掉真实端点 —— `/file/stats`
// 两边都没覆盖（上传/删除后统计卡片顶着 30s 旧值）、`CACHE.files` 的 `/files` 匹配不到任何
// 端点、`media` 域没有任何端点。现在端点归属只写一次，`domainPolicies.test.ts` 会扫全部
// `cachedRequest` 调用点，核对每个端点都在这张表里。
//
// 零依赖：cache.ts 与 domains.ts 都从这里取策略，避免两者互相 import 成环。

/** 域名：注册表的键，也是写入方 `domains.<名字>.invalidate(...)` 用的名字 */
export type DomainName =
	| "cards"
	| "bookmarks"
	| "tasks"
	| "db"
	| "onto"
	| "text"
	| "timeWindows"
	| "files";

export interface DomainPolicy {
	/** 列表/聚合/搜索的读端点（宽匹配） */
	readonly reads: readonly RegExp[];
	/** 单条实体读端点（实体后缀即写方 `{ entity }` 用的路径） */
	readonly singles?: readonly RegExp[];
	/** 写本域时连带失效的其他域 */
	readonly invalidates?: readonly DomainName[];
	/** 域级默认陈旧时长（缺省 DEFAULT_STALE_MS） */
	readonly staleMs?: number;
}

/** 每个域一条：`Record<DomainName, …>` 保证漏写/多写域在编译期就报错 */
export const DOMAIN_POLICIES: Record<DomainName, DomainPolicy> = {
	cards: {
		reads: [/^GET \/cards(?:\?|$)/, /^GET \/cards\/search\b/],
		singles: [/^GET \/cards\/\d+/],
	},
	bookmarks: {
		reads: [
			/^GET \/bookmarks(?:\?|$)/,
			/^GET \/bookmarks\/(?:search|tags|grouped-by-tag|check-url)\b/,
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
		// 任务树/统计/详情重算代价高，留 60s
		staleMs: 60_000,
	},
	db: { reads: [/^GET \/db\b/] },
	onto: {
		reads: [/^GET \/onto(?:\?|$)/],
		singles: [/^GET \/onto\/\d+/],
		// 本体数据不常变，留 60s
		staleMs: 60_000,
	},
	text: { reads: [/^GET \/text\b/] },
	timeWindows: {
		reads: [/^GET \/time-windows(?:\?|$)/],
		singles: [/^GET \/time-windows\/\d+/],
	},
	files: {
		reads: [
			/^GET \/file(?:\?|$)/,
			// 统计与标签是列表旁的聚合读：写入后必须跟着失效（stats 曾漏在这儿）
			/^GET \/file\/(?:stats|tags)\b/,
		],
		singles: [/^GET \/file\/[^?]+/],
	},
};

/** 未声明域级策略时的兜底陈旧时长 */
export const DEFAULT_STALE_MS = 30_000;

/** 缓存键归属的域；无归属返回 null（调用点漏登记的信号） */
export function domainOf(key: string): DomainName | null {
	for (const name of Object.keys(DOMAIN_POLICIES) as DomainName[]) {
		const policy: DomainPolicy = DOMAIN_POLICIES[name];
		const patterns = [...policy.reads, ...(policy.singles ?? [])];
		if (patterns.some((p) => p.test(key))) return name;
	}
	return null;
}

/** 按缓存键解析陈旧时长：显式值优先，否则域默认，兜底 DEFAULT_STALE_MS */
export function resolveStaleMs(key: string, explicit?: number): number {
	if (explicit !== undefined) return explicit;
	const domain = domainOf(key);
	if (domain === null) return DEFAULT_STALE_MS;
	const policy: DomainPolicy = DOMAIN_POLICIES[domain];
	return policy.staleMs ?? DEFAULT_STALE_MS;
}
