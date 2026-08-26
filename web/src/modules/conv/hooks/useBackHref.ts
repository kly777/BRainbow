import { PATHS } from "@config/paths";
// ── conv 页面共享逻辑 ──

import { buildQuery } from "@shared/api";
import { strParam, useUrlParams } from "@shared/utils";

/** 生成返回搜索页的链接（保留 q 和 t 参数） */
export function useBackHref(): () => string {
	const params = useUrlParams({ q: strParam(""), t: strParam("") });
	return () => {
		const q = params.get("q");
		const t = params.get("t");
		const qs = buildQuery({ q, t: t && t !== "all" ? String(t) : undefined });
		return `${PATHS.conversation}${qs}`;
	};
}
