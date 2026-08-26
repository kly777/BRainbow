// ── 建议列表构建（nav / cmd / 站内搜索）：纯函数，usePalette 以 memo 组合 ──

import { NAV_ROUTES } from "@config/navigation";
import { fillPath, PATHS } from "@config/paths";
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
		default:
			return PATHS.home;
	}
}

/** 路由导航建议（/ 前缀模式） */
export function buildNavItems(
	q: string,
	navigate: (path: string) => void,
	close: () => void,
): Suggestion[] {
	if (!q) {
		return NAV_ROUTES.map((r) => ({
			label: r.label,
			desc: r.desc,
			extra: r.path,
			onSelect: () => {
				navigate(r.path);
				close();
			},
		}));
	}
	const filtered = fuzzyFilter(NAV_ROUTES, q, (r) => [
		r.path.slice(1),
		r.label,
		r.desc,
	]);
	return filtered.map((r) => ({
		label: r.label,
		desc: r.desc,
		extra: r.path,
		onSelect: () => {
			navigate(r.path);
			close();
		},
	}));
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

/** 站内搜索建议（? 前缀模式），末尾附加"网页搜索"兜底项 */
export function buildSearchItems(
	hits: SearchHit[],
	q: string,
	searching: boolean,
	navigate: (path: string) => void,
	close: () => void,
): Suggestion[] {
	const items: Suggestion[] = hits.map((h) => ({
		label: h.title,
		desc: h.snippet,
		extra: KIND_LABEL[h.kind] ?? h.kind,
		onSelect: () => {
			navigate(resolveTargetUrl(h.target));
			close();
		},
	}));
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
