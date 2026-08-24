// ── 搜索输入归一化 ──

import type { Accessor } from "solid-js";

/**
 * trim 归一化的查询信号：空白输入折叠为 null（不触发 createResource 请求）。
 * 供标签搜索等「输入 → 资源」场景的 source 使用。
 */
export function trimmedQuery(query: Accessor<string>): Accessor<string | null> {
	return () => {
		const q = query().trim();
		return q.length > 0 ? q : null;
	};
}
