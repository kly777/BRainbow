// ── 书签 URL 的展示口径 ──
//
// BookmarkPage 与 BookmarkItem 各写了一份**字面相同**的 extractDomain（favicon
// 失败时的字母兜底要用域名首字母），搬到这里做唯一来源。
//
// 解析失败不回退到空串而是原样返回 url：非 URL 的书签（用户手输的怪值）宁可显示
// 原文本，也别在卡片上留一片空白。

import { trySync } from "@shared/utils";

/** 取主机名并去掉 `www.`；不是合法 URL 时原样返回 */
export function extractDomain(url: string): string {
	const result = trySync(() => new URL(url).hostname.replace(/^www\./, ""));
	return result.ok ? result.value : url;
}
