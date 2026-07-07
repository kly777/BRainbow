/**
 * 前端内存缓存层
 *
 * 提供 TTL 缓存 + 模式匹配失效，用于减少重复 API 请求。
 * 只缓存 GET 请求，增删改操作通过 invalidateCache 使相关缓存失效。
 *
 * 使用方式（在 API 模块中）：
 *
 *   import { cachedRequest, invalidateCache, CACHE } from "./request.ts";
 *
 *   // GET → 走缓存
 *   export const getCardsE = () => cachedRequest<PaginatedCards>("/cards", {});
 *
 *   // 写操作 → 失效相关缓存
 *   export const createCardE = (card) =>
 *     request("/cards", { method: "POST", body: JSON.stringify(card) })
 *       .then(invalidateCache(CACHE.cards));
 */

// ── 类型 ──

interface CacheEntry {
	readonly data: unknown;
	readonly fetchedAt: number;
}

// ── 存储 ──

const store = new Map<string, CacheEntry>();

// ── 缓存键前缀匹配模式（供 invalidateCache 使用） ──

/** 预定义的缓存失效模式，按 API 领域划分 */
export const CACHE = {
	cards: /^GET \/cards/,
	tasks: /^GET \/tasks/,
	db: /^GET \/db/,
	onto: /^GET \/onto/,
	sign: /^GET \/sign/,
	text: /^GET \/text/,
	timeWindows: /^GET \/time-windows/,
	media: /^GET \/media/,
	mem: /^GET \/mem/,
} as const;

// ── 默认 TTL ──

const DEFAULT_STALE_MS = 30_000;

// ── API ──

/**
 * 构建标准化的缓存键。
 */
export function buildCacheKey(method: string, endpoint: string): string {
	return `${method.toUpperCase()} ${endpoint}`;
}

/**
 * 读取缓存。如果不存在或已过期，返回 null 并删除过期条目。
 */
export function readCache<T>(key: string, staleMs = DEFAULT_STALE_MS): T | null {
	const entry = store.get(key);
	if (!entry) return null;
	if (Date.now() - entry.fetchedAt > staleMs) {
		store.delete(key);
		return null;
	}
	return entry.data as T;
}

/**
 * 写入缓存。
 */
export function writeCache(key: string, data: unknown): void {
	store.set(key, { data, fetchedAt: Date.now() });
}

/**
 * 使匹配正则表达式的缓存条目失效。
 * 在增删改操作完成后调用，确保下次读取拿到最新数据。
 *
 * @example
 *   invalidateCache(/^GET \/cards/)  // 使所有卡片相关缓存失效
 *   invalidateCache(CACHE.cards)     // 同上，使用预定义模式
 */
export function invalidateCache(pattern: RegExp): void {
	for (const key of store.keys()) {
		if (pattern.test(key)) {
			store.delete(key);
		}
	}
}

/**
 * 清除所有缓存。
 */
export function clearAllCache(): void {
	store.clear();
}

/**
 * 获取当前缓存条目数（用于调试）。
 */
export function cacheSize(): number {
	return store.size;
}

/**
 * 获取缓存快照（用于调试）。
 */
export function cacheSnapshot(): ReadonlyMap<string, { data: unknown; age: number }> {
	const now = Date.now();
	const snapshot = new Map<string, { data: unknown; age: number }>();
	for (const [key, entry] of store) {
		snapshot.set(key, { data: entry.data, age: now - entry.fetchedAt });
	}
	return snapshot;
}
