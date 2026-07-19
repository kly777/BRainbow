// ── conv 页面共享逻辑 ──

import { useSearchParams } from "@solidjs/router";

/** 生成返回搜索页的链接（保留 q 和 t 参数） */
export function useBackHref(): () => string {
	const [searchParams] = useSearchParams();
	return () => {
		const params = new URLSearchParams();
		const q = searchParams.q;
		const t = searchParams.t;
		if (q) params.set("q", String(q));
		if (t && t !== "all") params.set("t", String(t));
		const qs = params.toString();
		return qs ? `/conv?${qs}` : "/conv";
	};
}
