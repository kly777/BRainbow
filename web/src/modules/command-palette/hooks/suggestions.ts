// ── 建议列表构建（nav / cmd / 站内搜索）：纯函数，usePalette 以 memo 组合 ──

import { NAV_ROUTES } from "@config/navigation";
import type { SearchHit } from "../api.ts";
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

/** 路由导航建议（/ 前缀模式） */
export function buildNavItems(
	q: string,
	navigate: (path: string) => void,
	close: () => void,
): Suggestion[] {
	// 匹配质量排序：路径精确 > 路径前缀 > label 匹配 > desc 匹配 > 路径包含。
	// 输入 `/m` 时「记忆」(path=/m) 必须排在「书签」(path=/bookmark 含 m) 前面
	const score = (r: (typeof NAV_ROUTES)[number]): number => {
		const p = r.path.slice(1);
		if (p === q) return 0;
		if (p.startsWith(q)) return 1;
		if (r.label.includes(q)) return 2;
		if (r.desc.includes(q)) return 3;
		return 4; // 仅路径包含
	};
	return NAV_ROUTES.filter(
		(r) =>
			r.label.includes(q) || r.desc.includes(q) || r.path.slice(1).includes(q),
	)
		.sort((a, b) => score(a) - score(b))
		.map((r) => ({
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
	// 命令名（不含 : 前缀）前缀匹配优先于包含匹配
	const score = (c: CmdEntry): number => {
		const name = c.label.slice(1);
		if (name.startsWith(q)) return 0;
		if (c.label.includes(q)) return 1;
		return 2; // 仅 desc 匹配
	};
	return commands
		.filter((c) => c.label.slice(1).includes(q) || c.desc.includes(q))
		.sort((a, b) => score(a) - score(b))
		.map((c) => ({
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
			navigate(h.url);
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
