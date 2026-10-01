// ── 搜索命中的关键词高亮（纯字符串，产物是 HTML 片段） ──
//
// 三个消费方：搜索页、命令面板的站内搜索建议、文件列表的卡片/列表行。
// 原先各写一份（命令面板那份与搜索模块那份逐字相同），统一到这里：
// 转义顺序、大小写规则、多词切分只该有一处口径，否则同一个查询在三处会高亮得不一样。
//
// 消费方用 `innerHTML` 挂载，所以顺序是**先转义原文、再插入 `<mark>`** ——
// 不能反过来（先插标签再转义会把标记也转掉）。这也是 Meilisearch 那条
// "别把服务端格式化输出当 HTML 直接渲染"的通行做法：标记由本地生成、内容先转义。

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
 *
 * 查询词按空白切分，多个词各自高亮（大小写不敏感，与后端的"多词 = AND"同一口径）；
 * 空查询或空文本返回**空串** —— 调用方拿空串当"没有可高亮的内容"，
 * 退回渲染纯文本（别把空串直接塞进 innerHTML，名字会变空）。
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
