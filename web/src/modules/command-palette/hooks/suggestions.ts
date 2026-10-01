// ── 建议列表构建（nav / cmd / 站内搜索）：纯函数，usePalette 以 memo 组合 ──

import { NAV_ITEMS, NAV_ROUTES } from "@config/navigation";
import { fillPath, isConcretePath, PATHS } from "@config/paths";
// 这个文件跑在 node 环境的测试里，**不能走 `@shared/utils` 的 barrel**：
// 它会把整棵工具图拉进来，其中 @solidjs/router 在导入期就碰 `window`（会炸）
import { highlightKeywords } from "@shared/utils/highlight.ts";
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
			// 详情页路由参数是 stored_id，不是数字主键
			return fillPath(PATHS.fileDetail, target.params.stored_id);
		default:
			return PATHS.home;
	}
}

/**
 * 无前缀（idle）的候选：**打开面板直接打字就有用**。
 *
 * 之前 idle 什么都不给：输入框accept了输入却什么都不显示，回车还会静默关掉面板 ——
 * 用户得先知道 `/` `?` `:` 三个前缀才使得动（业界默认是"直接打字搜一切"）。
 * 现在：空输入 = 可直接跳的页面（最近访问优先，同 `/`）；有输入 = 本地模糊匹配
 * 那些页面 + 一条"在站内搜索「q」"（选中即切到 `?` 模式，在面板里原地看结果）。
 */
export function buildIdleItems(
	q: string,
	navigate: (path: string) => void,
	close: () => void,
	switchToSearch: (q: string) => void,
): Suggestion[] {
	const nav = buildNavItems(q, navigate, close);
	const trimmed = q.trim();
	if (!trimmed) return nav;
	return [
		...nav,
		{
			label: `在站内搜索「${trimmed}」`,
			desc: "任务 / 卡片 / 记忆 / 文件…",
			extra: "search",
			onSelect: () => switchToSearch(trimmed),
		},
	];
}

/**
 * 导航模式的候选页面：**只留能直接跳的实路径**。
 *
 * `NAV_ITEMS` 里还有一批详情页模板（`/file/:id`、`/card/edit/:id`…，`nav: false`），
 * 它们不是目的地 —— 选中后跳过去是字面量 URL 的坏页面。此前搜索分支把整份 NAV_ITEMS
 * 都拿去模糊匹配，于是 `/` 模式下能搜出这些模板来。
 *
 * 具体某个文件/卡片要看，走站内搜索（`?`）—— 那儿才有真实的 id。
 */
const NAVIGABLE_ITEMS = NAV_ITEMS.filter((r) => isConcretePath(r.path));

/** 路由导航建议（/ 前缀模式）：最近访问优先；搜索时扩展到全部可跳页面（含 nav:false 的管理页） */
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

	const filtered = fuzzyFilter(NAVIGABLE_ITEMS, q, (r) => [
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
