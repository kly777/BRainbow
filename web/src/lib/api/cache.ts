/**
 * 前端内存缓存层
 *
 * 提供 TTL 缓存 + 模式匹配失效，用于减少重复 API 请求。
 * 只缓存 GET 请求，增删改操作通过 invalidateCache 使相关缓存失效。
 *
 * 使用方式（在 API 模块中）：
 *
 *   import { cachedRequest, CACHE, tapInvalidate } from "./cache.ts";
 *   import { request } from "./request.ts";
 *
 *   // GET → 走缓存
 *   export const getCardsE = () => cachedRequest<PaginatedCards>("/cards", {});
 *
 *   // 写操作 → 失效相关缓存
 *   export const createCardE = (card) =>
 *     request("/cards", { method: "POST", body: JSON.stringify(card) })
 *       .then((r) => tapInvalidate(CACHE.cards, r));
 */

// ── request 直接从具体文件导入（避免 index 的 re-export 循环） ──

import { request } from "./request.ts";

// ── 类型 ──

interface CacheEntry {
	readonly data: unknown;
	readonly fetchedAt: number;
}

// ── 存储 ──

const store = new Map<string, CacheEntry>();

/** 缓存条目上限：无限分页/搜索会产生无限 key，超出后按插入顺序淘汰最旧条目 */
const MAX_ENTRIES = 200;

// ── 缓存键前缀匹配模式（供 invalidateCache 使用） ──

/** 预定义的缓存失效模式，按 API 领域划分 */
export const CACHE = {
	cards: /^GET \/cards/,
	bookmarks: /^GET \/bookmarks/,
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
export function readCache<T>(
	key: string,
	staleMs = DEFAULT_STALE_MS,
): T | null {
	const entry = store.get(key);
	if (!entry) return null;
	if (Date.now() - entry.fetchedAt > staleMs) {
		store.delete(key);
		return null;
	}
	return entry.data as T;
}

/**
 * 写入缓存；超过 MAX_ENTRIES 时淘汰最早插入的条目，防止 Map 无界增长。
 */
export function writeCache(key: string, data: unknown): void {
	store.set(key, { data, fetchedAt: Date.now() });
	if (store.size <= MAX_ENTRIES) return;
	const excess = store.size - MAX_ENTRIES;
	let removed = 0;
	for (const oldest of store.keys()) {
		if (removed >= excess) break;
		store.delete(oldest);
		removed += 1;
	}
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
export function cacheSnapshot(): ReadonlyMap<
	string,
	{ data: unknown; age: number }
> {
	const now = Date.now();
	const snapshot = new Map<string, { data: unknown; age: number }>();
	for (const [key, entry] of store) {
		snapshot.set(key, { data: entry.data, age: now - entry.fetchedAt });
	}
	return snapshot;
}

// ==================== cachedRequest ====================

/**
 * 带缓存的 GET 请求。对于非 GET 请求，行为与 request() 相同。
 *
 * @param endpoint - API 路径（不含 /api 前缀）
 * @param options - fetch options
 * @param staleMs - 缓存有效期，默认 30 秒
 */
export const cachedRequest = async <T>(
	endpoint: string,
	options: RequestInit = {},
	staleMs = DEFAULT_STALE_MS,
): Promise<T> => {
	const method = (options.method ?? "GET").toUpperCase();

	// 非 GET 请求不走缓存
	if (method !== "GET") {
		return request<T>(endpoint, options);
	}

	const key = buildCacheKey(method, endpoint);
	const cached = readCache<T>(key, staleMs);
	if (cached !== null) {
		return cached;
	}

	const data = await request<T>(endpoint, options);
	writeCache(key, data);
	return data;
};

/**
 * 在 Promise 链中使缓存失效并透传结果。
 * 用于增删改操作完成后自动失效相关缓存。
 *
 * @example
 *   request("/cards", { method: "POST", body })
 *     .then((r) => tapInvalidate(CACHE.cards, r))
 */
export function tapInvalidate<T>(pattern: RegExp, result: T): T {
	invalidateCache(pattern);
	return result;
}

/**
 * 包装写操作的 Promise，自动失效相关缓存。
 * 替代 `.then((r) => tapInvalidate(CACHE.xxx, r))` 模式，减少样板代码。
 *
 * @example
 *   // Before:
 *   export const createCardE = (card) =>
 *     post<Card>("/cards", card).then((r) => tapInvalidate(CACHE.cards, r));
 *
 *   // After:
 *   export const createCardE = (card) =>
 *     withInvalidate(CACHE.cards, post<Card>("/cards", card));
 */
export function withInvalidate<T>(
	pattern: RegExp,
	promise: Promise<T>,
): Promise<T> {
	return promise.then((result) => {
		invalidateCache(pattern);
		return result;
	});
}
