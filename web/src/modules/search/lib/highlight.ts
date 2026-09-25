// ── 搜索命中的关键词高亮（纯字符串，产物是 HTML 片段） ──
//
// 从 SearchPage 内联搬出来：转义 + 逐词正则 + 拼 `<mark>` 是纯算法，留在组件里
// 只能靠渲染观察；抽出来才能直测（尤其查询词里带正则元字符、以及必须转义 HTML）。
//
// 消费方用 `innerHTML` 挂载，所以顺序是先转义原文、再插入 `<mark>` ——
// 不能反过来（先插标签再转义会把标记也转掉）。

/** HTML 转义：& < >（引号不必转，产物只作为元素内容挂载） */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** 正则元字符转义：查询词按字面匹配，`a.b` 不该命中 "axb" */
function escapeRegExp(term: string): string {
	return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 把 `text` 中命中 `query` 的词包成 `<mark>`，返回已转义的 HTML 片段。
 * 查询词按空白切分，多个词各自高亮（大小写不敏感）；空查询或空文本返回空串。
 */
export function highlightKeywords(text: string, query: string): string {
	if (!query || !text) return "";
	const terms = query.trim().split(/\s+/).filter(Boolean);
	let result = escapeHtml(text);
	for (const term of terms) {
		const re = new RegExp(escapeRegExp(term), "gi");
		result = result.replace(re, (m) => `<mark>${m}</mark>`);
	}
	return result;
}
