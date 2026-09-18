// ── 在"一段段文本"里查找（纯函数） ──
//
// 查找作用于**已渲染的 DOM 文本节点**，而不是各自查看器的源文本：一套实现就能覆盖
// 纯文本、代码高亮、Markdown 渲染、CSV 表格、docx/epub 的受限 HTML —— 它们最终的
// 内容都是 DOM 里的文本节点。代价是**跨节点的命中找不到**（查询串跨越了标签边界，
// 比如 Markdown 里 `**粗**体` 的"粗体"），这条限制可接受：这类命中在视觉上本来也不连续。
//
// 不引正则的元字符要转义：用户输入 `.` `*` `(` 这类字符时应当按字面匹配。

/** 一次命中：第 nodeIndex 个文本节点里 [start, end) */
export interface TextMatch {
	nodeIndex: number;
	start: number;
	end: number;
}

export interface FindResult {
	matches: TextMatch[];
	/** 命中数触顶（大文件里查单个字母），只保证前 N 个可用 */
	capped: boolean;
}

/**
 * 命中数上限：4MB 文本里查 "e" 会有几十万条，全存下来既费内存又没人会翻到那么远。
 * 触顶后提醒用户把查询写具体些。
 */
export const MAX_MATCHES = 2000;

/** 正则元字符转义（用户输入按字面匹配） */
function escapeRegExp(input: string): string {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在若干文本节点里找 `query`（**不区分大小写**，按出现顺序）。
 * 空查询返回空结果 —— 调用方据此显示"输入关键字"而不是"0/0"。
 */
export function findInTextNodes(texts: string[], query: string): FindResult {
	const needle = query.trim();
	if (!needle) return { matches: [], capped: false };

	let pattern: RegExp;
	try {
		// 用正则而不是 indexOf 是为了原生的大小写不敏感：先 toLowerCase 再比会把
		// 长度可能变化的字符（如 'İ'）映射错位，导致高亮位置偏移
		pattern = new RegExp(escapeRegExp(needle), "gi");
	} catch {
		return { matches: [], capped: false };
	}

	const matches: TextMatch[] = [];
	for (let i = 0; i < texts.length; i++) {
		pattern.lastIndex = 0;
		const text = texts[i];
		if (!text) continue;
		let found: RegExpExecArray | null = pattern.exec(text);
		while (found) {
			matches.push({
				nodeIndex: i,
				start: found.index,
				end: found.index + found[0].length,
			});
			if (matches.length >= MAX_MATCHES) return { matches, capped: true };
			found = pattern.exec(text);
		}
	}
	return { matches, capped: false };
}
