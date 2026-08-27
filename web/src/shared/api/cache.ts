/**
 * 前端内存缓存层
 *
 * 提供 TTL 缓存 + 模式匹配失效，用于减少重复 API 请求。
 * 只缓存 GET 请求，增删改操作通过 domains（见 domains.ts）使相关缓存失效。
 *
 * cachedRequest 是"读穿缓存"：
 *   - 单一飞行：同一 key 的并发请求合并为一次网络请求，N 个读者共享同一个 Promise；
 *   - 陈旧重验证：命中过期条目时立即返回旧值，后台静默刷新（失败保留旧值，下次再试）。
 *
 * 使用方式（在 API 模块中）：
 *
 *   import { cachedRequest, domains } from "@shared/api";
 *
 *   // GET → 走缓存
 *   export const getCardsE = () => cachedRequest<PaginatedCards>("/cards", {});
 *
 *   // 写操作 → 失效相关缓存
 *   export const createCardE = (card) =>
 *     domains.cards.invalidate(post<Card>("/cards", card));
 */

// ── request 直接从具体文件导入（避免 index 的 re-export 循环） ──

import { DEFAULT_STALE_MS, resolveStaleMs } from "./domainPatterns.ts";
import { request } from "./request.ts";

// ── 类型 ──

interface CacheEntry {
	readonly data: unknown;
	readonly fetchedAt: number;
}

// ── 存储 ──

const store = new Map<string, CacheEntry>();

/** 飞行中的请求：单一飞行合并（同一 key 的并发读者共享同一 Promise） */
const inFlight = new Map<string, Promise<unknown>>();

/** 缓存条目上限：无限分页/搜索会产生无限 key，超出后按插入顺序淘汰最旧条目 */
const MAX_ENTRIES = 200;

// ── 默认 TTL（单一来源：domainPatterns.ts） ──

// ── API ──

/**
 * 构建标准化的缓存键：查询参数排序后再编码，参数顺序不影响身份
 * （?page=1&page_size=20 与 ?page_size=20&page=1 视为同一份数据）。
 */
export function buildCacheKey(method: string, endpoint: string): string {
	const [path, query = ""] = endpoint.split("?");
	const sp = new URLSearchParams(query);
	sp.sort();
	const sorted = sp.toString();
	return `${method.toUpperCase()} ${path}${sorted ? `?${sorted}` : ""}`;
}

/**
 * 精确删除单个缓存键（供实体级失效使用）。
 */
export function deleteCacheKey(key: string): void {
	store.delete(key);
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
 * 失效模式由 domains.ts 统一声明。
 *
 * @example
 *   invalidateCache(/^GET \/cards/)  // 使所有卡片相关缓存失效
 */
export function invalidateCache(pattern: RegExp): void {
	for (const key of store.keys()) {
		if (pattern.test(key)) {
			store.delete(key);
		}
	}
}

/**
 * 清除所有缓存（含飞行中的请求）。
 */
export function clearAllCache(): void {
	store.clear();
	inFlight.clear();
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

// ==================== cachedRequest（读穿缓存） ====================

interface CacheLookup<T> {
	/** 命中的缓存数据 */
	readonly data: T;
	/** 是否仍在 staleMs 有效期内（false = 过期，可先回旧值再后台刷新） */
	readonly fresh: boolean;
}

/**
 * 读取缓存，返回 { data, fresh }；不存在返回 null。
 * 与 readCache 不同：不删除过期条目（供陈旧重验证使用）。
 */
function lookup<T>(key: string, staleMs: number): CacheLookup<T> | null {
	const entry = store.get(key);
	if (!entry) return null;
	return {
		data: entry.data as T,
		fresh: Date.now() - entry.fetchedAt <= staleMs,
	};
}

/**
 * 发起请求并写入缓存，同一 key 的并发调用共享同一 Promise（单一飞行）。
 */
function runInFlight<T>(
	key: string,
	endpoint: string,
	options: RequestInit,
): Promise<T> {
	const pending = inFlight.get(key);
	if (pending) return pending as Promise<T>;
	const promise = request<T>(endpoint, options)
		.then((data) => {
			writeCache(key, data);
			return data;
		})
		.finally(() => {
			inFlight.delete(key);
		});
	inFlight.set(key, promise);
	return promise;
}

/**
 * 后台静默刷新：失败不打断用户，保留旧值待下次读取再试。
 */
function refreshInBackground<T>(
	key: string,
	endpoint: string,
	options: RequestInit,
): void {
	void runInFlight<T>(key, endpoint, options).catch((error: unknown) => {
		console.error(`[CACHE] 后台刷新失败 ${endpoint}:`, error);
	});
}

/**
 * 带缓存的 GET 请求。对于非 GET 请求，行为与 request() 相同。
 *
 * 命中语义：
 * - 有效期内 → 直接返回缓存值；
 * - 已过期但存在 → 立即返回旧值，并在后台静默刷新（陈旧重验证）；
 * - 未命中 → 发起请求（同一 key 的并发调用合并为一次）。
 *
 * @param endpoint - API 路径（不含 /api 前缀）
 * @param options - fetch options
 * @param staleMs - 缓存有效期，默认 30 秒
 */
export const cachedRequest = async <T>(
	endpoint: string,
	options: RequestInit = {},
	staleMs?: number,
): Promise<T> => {
	const method = (options.method ?? "GET").toUpperCase();

	// 非 GET 请求不走缓存
	if (method !== "GET") {
		return request<T>(endpoint, options);
	}

	const key = buildCacheKey(method, endpoint);
	// 未显式传陈旧时长 → 按端点匹配域级默认（见 domainPatterns.ts）
	const effectiveStaleMs = resolveStaleMs(key, staleMs);
	const hit = lookup<T>(key, effectiveStaleMs);
	if (hit === null) {
		return runInFlight<T>(key, endpoint, options);
	}
	if (hit.fresh) {
		return hit.data;
	}
	// 已过期 → 先回旧值，后台静默刷新
	refreshInBackground<T>(key, endpoint, options);
	return hit.data;
};
