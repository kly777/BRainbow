// ── 录入语法的解析器（纯函数，前端本地执行，不调后端）──
//
// 为什么在前端：录入要即时反馈 —— 每敲一个字符都要重新解析并预览，网络往返会让
// "回车即创建"的体感崩掉；而且这是纯文本变换，放后端没有收益。
//
// ## 符号表（只有四个）
//
// | 符号 | 含义 | 语法 | 落库字段 |
// |---|---|---|---|
// | `!` | 优先级 | `!p1`…`!p4`（大小写不敏感） | `task.priority` |
// | `#` | 标签 | `#工作` `#urgent` | `task_tag_rel` |
// | `@` | 提及 | `@bob` | 本期只解析不落库（进 description） |
// | `~` | 时长 | `~60m` `~1.5h` `~2h` `~90`（裸数字按分钟） | `effort_estimate_minutes` |
//
// **日期没有符号**，这是刻意的：标题行只认显式符号，"周内第几天"要用符号表达就得
// 发明一套 mini 语言（`@mon` 还是 `!fri`？），成本高于收益；而且自然语言日期解析的
// 误报是产品级常态（"Create monthly report" 里的 monthly）。日期走第 2 层的控件，
// 抄 Things 3 的做法：NLP 只关在专用弹窗里，标题行永远不解析。
//
// ## 匹配规则
//
// 1. **token 按空白切**（`token 前是行首或空白`）—— `买牛奶#加急` 里的 `#` 前面是
//    汉字，不构成 token 分界，整串留作标题
// 2. token 内再看符号：**优先级/时长要求整个 token 匹配**（所以 `!p1x`、`~abc` 不解析），
//    **标签/提及取允许字符的最长前缀**（所以 `#a,b` 截到逗号、`#a#b` 认一个标签 "a"），
//    没被吃掉的部分原样留在标题里 —— 不静默丢用户写的字
// 3. 未识别的 token **静默留在标题里**，只是把"看着像符号却没解析成功"的记进
//    `unparsed`，让界面能提示一句
//
// ## 与全局浮窗的类型前缀是两回事
//
// 浮窗里行首的 `#`/`@` 是**类型前缀**（`#` = 建任务、`@url` = 存书签），判定在
// `quick-capture/hooks/useQuickCapture.ts` 的 `detectType`，它在剥掉前缀之后才调这里。
// 本函数只认"行内 token"：任务页的录入框里 `#` 就是标签（没有类型前缀这回事）。

import type { TaskPriority } from "../api-types.ts";

/** 优先级取第一个、标签全部保留、时长取第一个 —— 与 Todoist/RTM 的任意顺序一致 */
export interface CaptureResult {
	/** 原始输入（trim 后）：预览要能显示"我原本写了什么" */
	title: string;
	/** 剥离 token、折叠空白后的标题 —— 展示与创建都用它 */
	cleanTitle: string;
	priority: TaskPriority | null;
	tags: string[];
	mentions: string[];
	effortMinutes: number | null;
	/** 看着像符号、但没解析成功、留在标题里的片段（第 1 层下方的提示用） */
	unparsed: string[];
}

/** 标签/提及名允许的字符：Unicode 字母、数字、下划线、连字符（中文标签免转义） */
const NAME_RUN = /^[\p{L}\p{N}_-]+/u;

const PRIORITY_TOKEN = /^![pP]([1-4])$/;

/** `~(数字)(单位)?`；单位缺省按分钟。整 token 匹配 —— `~abc`、`~1d` 都不算 */
const EFFORT_TOKEN = /^~(\d+(?:\.\d+)?)(m|min|h|hr|小时|分钟)?$/iu;

/** 标签名上限（超过就不是"标签"了，整 token 留标题里） */
const MAX_TAG_LENGTH = 32;

interface Token {
	text: string;
	start: number;
	end: number;
}

/** 按空白切 token，带原文偏移（offsets 相对**原始输入**，用于精确删除） */
function tokenize(input: string): Token[] {
	const tokens: Token[] = [];
	const re = /\S+/g;
	for (const match of input.matchAll(re)) {
		const start = match.index;
		tokens.push({ text: match[0], start, end: start + match[0].length });
	}
	return tokens;
}

/** 时长 token → 分钟（裸数字按分钟；h/hr/小时 × 60），取整 */
function toMinutes(value: string, unit: string | undefined): number {
	const amount = Number(value);
	const normalized = (unit ?? "m").toLowerCase();
	const isHour =
		normalized === "h" || normalized === "hr" || normalized === "小时";
	return Math.round(isHour ? amount * 60 : amount);
}

export function parseCapture(input: string): CaptureResult {
	// 被吃掉的范围：最后按它们从原文里挖掉，剩下的就是标题
	const consumed: Array<[number, number]> = [];
	const tags: string[] = [];
	const mentions: string[] = [];
	const unparsed: string[] = [];
	let priority: TaskPriority | null = null;
	let effortMinutes: number | null = null;

	for (const token of tokenize(input)) {
		const { text, start } = token;

		if (text.startsWith("!")) {
			const match = PRIORITY_TOKEN.exec(text);
			if (match) {
				// 重复出现取第一个（`!p3 !p1` → p3），第二个也吃掉，不留成标题里的噪音
				priority ??= `p${match[1]}` as TaskPriority;
				consumed.push([token.start, token.end]);
			} else {
				unparsed.push(text);
			}
			continue;
		}

		if (text.startsWith("~")) {
			const match = EFFORT_TOKEN.exec(text);
			const minutes = match ? toMinutes(match[1], match[2]) : 0;
			if (match && minutes > 0) {
				effortMinutes ??= minutes;
				consumed.push([token.start, token.end]);
			} else {
				// `~0` 与 `~abc` 一类：留在标题里并提示（0 分钟无意义）
				unparsed.push(text);
			}
			continue;
		}

		if (text.startsWith("#")) {
			const name = NAME_RUN.exec(text.slice(1))?.[0];
			if (name && name.length <= MAX_TAG_LENGTH) {
				tags.push(name);
				// 只吃 `#` + 名字：`#a,b` 里剩下的 ",b" 留在标题（不静默丢字）
				consumed.push([start, start + 1 + name.length]);
			} else {
				unparsed.push(text);
			}
			continue;
		}

		if (text.startsWith("@")) {
			const name = NAME_RUN.exec(text.slice(1))?.[0];
			// `@https://a.b` 里的 "https" 不是提及：名字后面接 `:` 或 `/` 就是 URL
			// （浮窗里 `@` + URL 是书签，工具栏里也不该把一个 URL 拆成提及 + 残渣）
			const rest = name ? text.slice(1 + name.length) : "";
			const looksLikeUrl = rest.startsWith(":") || rest.startsWith("/");
			if (name && !looksLikeUrl) {
				mentions.push(name);
				consumed.push([start, start + 1 + name.length]);
			} else if (!looksLikeUrl) {
				unparsed.push(text);
			}
		}
	}

	return {
		title: input.trim(),
		cleanTitle: strip(input, consumed),
		priority,
		tags,
		mentions,
		effortMinutes,
		unparsed,
	};
}

/** 挖掉 `consumed` 的范围（换成空格），再折叠空白 —— `写周报   !p1` → `写周报` */
function strip(input: string, consumed: Array<[number, number]>): string {
	if (consumed.length === 0) {
		return collapse(input);
	}
	let kept = "";
	let cursor = 0;
	for (const [start, end] of [...consumed].sort((a, b) => a[0] - b[0])) {
		kept += input.slice(cursor, start);
		cursor = end;
	}
	kept += input.slice(cursor);
	return collapse(kept);
}

function collapse(text: string): string {
	return text.replace(/\s+/gu, " ").trim();
}
