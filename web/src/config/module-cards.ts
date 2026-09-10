// ── 模块入口卡片：首页九宫格与落地页目录的单一数据来源 ──
// icon 用 Heroicons outline 风 SVG path；识别色走 --m-* 令牌；
// title/detail 为落地页长文案，缺省则该模块不上落地页目录。
import { PATHS } from "./paths.ts";

export interface ModuleCard {
	path: string;
	icon: string;
	color: string;
	/** 首页短标签 */
	label: string;
	/** 首页短描述 */
	desc: string;
	/** 落地页标题 */
	title?: string;
	/** 落地页长描述 */
	detail?: string;
}

export const MODULE_CARDS: ModuleCard[] = [
	{
		path: PATHS.task,
		label: "任务",
		desc: "待办事项",
		title: "任务管理",
		detail: "列表、看板、日历、DAG 四种视图",
		icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
		color: "var(--m-task)",
	},
	{
		path: PATHS.card,
		label: "卡片",
		desc: "知识库",
		title: "知识卡片",
		detail: "记录知识片段，构建个人知识库",
		icon: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
		color: "var(--m-card)",
	},
	{
		path: PATHS.memory,
		label: "记忆",
		desc: "FSRS 复习",
		title: "间隔记忆",
		detail: "基于 FSRS 算法的智能间隔复习",
		icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
		color: "var(--m-mem)",
	},
	{
		path: PATHS.ontology,
		label: "本体",
		desc: "概念网络",
		title: "本体系统",
		detail: "概念本体与符号关系，结构化思维",
		icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4",
		color: "var(--m-onto)",
	},
	{
		path: PATHS.conversation,
		label: "搜索",
		desc: "知识搜索",
		title: "知识搜索",
		detail: "搜索 AI 对话历史，快速定位知识",
		icon: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
		color: "var(--m-search)",
	},
	{
		path: PATHS.chat,
		label: "AI",
		desc: "对话",
		title: "AI 对话",
		detail: "多轮对话、树状分支、修订上下文",
		icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
		color: "var(--m-chat)",
	},
	{
		path: PATHS.bookmark,
		label: "书签",
		desc: "收藏",
		title: "书签管理",
		detail: "收藏和整理网页书签",
		icon: "M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z",
		color: "var(--m-bookmark)",
	},
	{
		path: PATHS.text,
		label: "文本",
		desc: "编辑器",
		title: "文本编辑",
		detail: "多标签纯文本编辑器",
		icon: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
		color: "var(--m-text)",
	},
];
