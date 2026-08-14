import { PATHS } from "@config/paths";
// ── conv 页面共享逻辑 ──

import { buildQuery } from "@lib/api";
import { useSearchParams } from "@solidjs/router";

/** 生成返回搜索页的链接（保留 q 和 t 参数） */
export function useBackHref(): () => string {
	const [searchParams] = useSearchParams();
	return () => {
		const q = searchParams.q;
		const t = searchParams.t;
		const qs = buildQuery({ q, t: t && t !== "all" ? String(t) : undefined });
		return `${PATHS.conversation}${qs}`;
	};
}
