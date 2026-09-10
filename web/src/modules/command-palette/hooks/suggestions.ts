// ── 建议列表构建（nav / cmd / 站内搜索）：纯函数，usePalette 以 memo 组合 ──

import { NAV_ITEMS, NAV_ROUTES } from "@config/navigation";
import { fillPath, PATHS } from "@config/paths";
import { getRecentPages } from "@shared/utils/recent-pages.ts";
import type { SearchHit, SearchTarget } from "../api.ts";
import { fuzzyFilter } from "./fuzzy.ts";
import type { Suggestion } from "./usePalette.ts";

const BING = "https://www.bing.com/search?q=";
const DUCK = "https://duckduckgo.com/?q=";
let _engine = BING;

export function probeDuck() {
	const img = new Image();
	img.onload = () => {
		_engine = DUCK;
	};
	img.src = "https://duckduckgo.com/favicon.ico";
}

export function searchWeb(query: string) {
	globalThis.open(`${_engine}${encodeURIComponent(query.trim())}`, "_blank");
}

/** 站内搜索结果的模块中文标签 */
export const KIND_LABEL: Record<string, string> = {
	mem: "记忆",
	card: "卡片",
	task: "任务",
	bookmark: "书签",
	onto: "本体",
	text: "文本",
	reading: "阅读",
	conv: "对话",
	chat: "AI 对话",
	file: "文件",
};

/** 将 SearchTarget 解析为前端 URL */
export function resolveTargetUrl(target: SearchTarget): string {
	switch (target.type) {
		case "Task":
			return fillPath(PATHS.taskDetail, target.params.id);
		case "Card":
			return fillPath(PATHS.cardDetail, target.params.id);
		case "Onto":
			return fillPath(PATHS.ontologyDetail, target.params.id);
		case "Bookmark":
			return fillPath(PATHS.bookmarkDetail, target.params.id);
		case "Reading":
			return fillPath(PATHS.readingDetail, target.params.id);
		case "Memory":
			return `${PATHS.memoryManage}?id=${target.params.id}`;
		case "ChatTree":
			return `${PATHS.chat}?tree=${target.params.tree_id}`;
		case "ChatNode":
			return `${PATHS.chat}?tree=${target.params.tree_id}&node=${target.params.node_id}`;
		case "Conv":
			return fillPath(PATHS.convDetail, target.params.id);
		case "Text":
			return PATHS.text;
		case "File":
			return fillPath(PATHS.fileDetail, target.params.id);
		default:
			return PATHS.home;
	}
}

/** 路由导航建议（/ 前缀模式）：最近访问优先，搜索时扩展到全部页面 */
export function buildNavItems(
	q: string,
	navigate: (path: string) => void,
	close: () => void,
): Suggestion[] {
	const makeItem = (r: (typeof NAV_ITEMS)[number]) => ({
		label: r.label,
		desc: r.desc,
		extra: r.path,
		onSelect: () => {
			navigate(r.path);
			close();
		},
	});

	if (!q) {
		// 最近访问的页面排在前面
		const recent = new Set(getRecentPages());
		const recentItems = NAV_ROUTES.filter((r) => recent.has(r.path));
		const otherItems = NAV_ROUTES.filter((r) => !recent.has(r.path));
		return [...recentItems.map(makeItem), ...otherItems.map(makeItem)];
	}

	// 搜索时使用全部页面（包括详情页等非 nav 页面）
	const filtered = fuzzyFilter(NAV_ITEMS, q, (r) => [
		r.path.slice(1),
		r.label,
		r.desc,
		r.title,
	]);
	return filtered.map(makeItem);
}

interface CmdEntry {
	label: string;
	desc: string;
	action: () => void;
}

/** 指令建议（: 前缀模式） */
export function buildCmdItems(q: string, commands: CmdEntry[]): Suggestion[] {
	if (!q) {
		return commands.map((c) => ({
			label: c.label,
			desc: c.desc,
			onSelect: c.action,
		}));
	}
	const filtered = fuzzyFilter(commands, q, (c) => [c.label.slice(1), c.desc]);
	return filtered.map((c) => ({
		label: c.label,
		desc: c.desc,
		onSelect: c.action,
	}));
}

/** 将文本中的关键词用 <mark> 标签高亮（转义 HTML 实体后替换） */
function highlightKeywords(text: string, query: string): string {
	if (!query || !text) return "";
	const escaped = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
	const terms = query.trim().split(/\s+/).filter(Boolean);
	let result = escaped;
	for (const term of terms) {
		const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		result = result.replace(re, (m) => `<mark>${m}</mark>`);
	}
	return result;
}

/** 站内搜索建议（? 前缀模式），按模块分组展示，末尾附加"网页搜索"兜底项 */
export function buildSearchItems(
	hits: SearchHit[],
	q: string,
	searching: boolean,
	navigate: (path: string) => void,
	close: () => void,
): Suggestion[] {
	if (hits.length === 0) {
		if (q && !searching) {
			return [
				{
					label: `在浏览器中搜索「${q}」`,
					desc: "站内未命中时使用外部搜索引擎",
					extra: "web",
					onSelect: () => {
						searchWeb(q);
						close();
					},
				},
			];
		}
		return [];
	}

	// 按 kind 分组，保持原始顺序
	const groups = new Map<string, SearchHit[]>();
	for (const h of hits) {
		const arr = groups.get(h.kind);
		if (arr) arr.push(h);
		else groups.set(h.kind, [h]);
	}

	const items: Suggestion[] = [];
	for (const [kind, groupHits] of groups) {
		const label = KIND_LABEL[kind] ?? kind;
		// 多组时添加分组标题
		if (groups.size > 1) {
			items.push({
				label: `${label}（${groupHits.length}）`,
				desc: "",
				extra: "",
				isHeader: true,
				onSelect: () => {},
			});
		}
		for (const h of groupHits) {
			items.push({
				label: h.title,
				desc: h.snippet,
				highlightedDesc: highlightKeywords(h.snippet, q),
				extra: groups.size === 1 ? label : undefined,
				onSelect: () => {
					navigate(resolveTargetUrl(h.target));
					close();
				},
			});
		}
	}

	if (q && !searching) {
		items.push({
			label: `在浏览器中搜索「${q}」`,
			desc: "站内未命中时使用外部搜索引擎",
			extra: "web",
			onSelect: () => {
				searchWeb(q);
				close();
			},
		});
	}
	return items;
}
