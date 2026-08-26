// ── 缓存域绑定：一扇门 ──
//
// resource("bookmarks") → { invalidate }
// 调用方不再接触 CACHE 正则、tapInvalidate、withInvalidate；
// 缓存协议收敛为此一个入口。

import { CACHE, invalidateCache } from "./cache.ts";

export interface CacheResource {
	/**
	 * 包装写操作 Promise，成功后自动失效本域缓存。
	 * @example
	 *   const bm = resource("bookmarks");
	 *   export const createBookmarkE = (req) => bm.invalidate(post("/bookmarks", req));
	 */
	invalidate<T>(promise: Promise<T>): Promise<T>;
}

/**
 * 按域绑定缓存失效协议。
 * @param domain - CACHE 对象中的键名（如 "cards"、"bookmarks"、"mem"）
 */
export function resource(domain: keyof typeof CACHE): CacheResource {
	const pattern = CACHE[domain];
	return {
		invalidate<T>(promise: Promise<T>): Promise<T> {
			return promise.then((result) => {
				invalidateCache(pattern);
				return result;
			});
		},
	};
}
