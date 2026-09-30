// ── 域注册表：失效策略的唯一来源 ──
//
// 收敛点（替代 resource()）：
//   domains.cards.invalidate(writePromise)
// 每个域的读模式/连带域/陈旧时长写在 domainPolicies.ts 的 DOMAIN_POLICIES：
//   reads        — 本域「宽」读模式（写操作连坐失效：列表/聚合/搜索）
//   singles      — 单条实体读模式（只用来给实体读定域，见 domainPolicies.ts 的说明）
//   invalidates  — 写入本域时连带失效的其他域（跨域依赖）
// 写入方只需声明"动了哪个域"（+ 可选 entity），清哪些读键由这张表决定。

import { invalidateCache, invalidateCachePrefix } from "./cache.ts";
import {
	DOMAIN_POLICIES,
	type DomainName,
	type DomainPolicy,
} from "./domainPolicies.ts";

export type { DomainName } from "./domainPolicies.ts";

interface CacheResource {
	/**
	 * 包装写操作 Promise，成功后自动失效本域（及连带域）缓存。
	 * @param promise - 写操作 Promise
	 * @param opts.entity - 被写实体的 API 路径（如 "/cards/5"）：清掉该实体及其子读的缓存
	 *                      （`/cards/5/detail` 这类子路径一并清），不连坐同域其他实体。
	 * @example
	 *   // 创建（无实体）→ 连坐清列表/搜索
	 *   domains.cards.invalidate(post("/cards", req));
	 *   // 更新（指定实体）→ 连坐清列表/搜索 + 清该实体（含子读）
	 *   domains.cards.invalidate(patch("/cards/5", req), { entity: "/cards/5" });
	 */
	invalidate<T>(promise: Promise<T>, opts?: { entity?: string }): Promise<T>;
}

/** 本域「宽」读模式 + 连带域的全部失效模式 */
function broadPatternsFor(domain: DomainName): readonly RegExp[] {
	const policy: DomainPolicy = DOMAIN_POLICIES[domain];
	const patterns = [...policy.reads];
	for (const other of policy.invalidates ?? []) {
		patterns.push(...DOMAIN_POLICIES[other].reads);
	}
	return patterns;
}

export const domains = Object.fromEntries(
	Object.keys(DOMAIN_POLICIES).map((name) => {
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
						// 实体自身（含子读）清掉：`/cards/5` 连带 `/cards/5/detail`
						if (opts?.entity) invalidateCachePrefix(opts.entity);
						return result;
					});
				},
			},
		];
	}),
) as Record<DomainName, CacheResource>;
