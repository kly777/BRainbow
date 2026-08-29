// ── 导航元数据（纯数据，无组件；路径来自 paths.ts 单一来源） ──
// 新增页面：paths.ts 定义路径 → 此处加条目 → app/routes.ts 自动派生路由

import { PATHS, type PathValue } from "./paths.ts";

export interface NavItem {
	path: PathValue;
	label: string;
	title: string;
	desc: string;
	nav: boolean;
}

export const NAV_ITEMS: NavItem[] = [
	{
		path: PATHS.home,
		label: "主页",
		title: "Brainbow",
		desc: "首页面板",
		nav: true,
	},
	{
		path: PATHS.search,
		label: "搜索",
		title: "Search",
		desc: "全局搜索结果",
		nav: false,
	},
	{
		path: PATHS.task,
		label: "任务",
		title: "Tasks",
		desc: "任务管理",
		nav: true,
	},
	{
		path: PATHS.taskDetail,
		label: "任务详情",
		title: "Task",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.ontology,
		label: "本体",
		title: "Ontology",
		desc: "本体与符号系统",
		nav: true,
	},
	{
		path: PATHS.ontologyDetail,
		label: "本体详情",
		title: "Ontology Item",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.card,
		label: "卡片",
		title: "Cards",
		desc: "知识卡片浏览",
		nav: true,
	},
	{
		path: PATHS.color,
		label: "配色",
		title: "Color",
		desc: "全局主题配色切换",
		nav: true,
	},
	{
		path: PATHS.cardAdd,
		label: "新建卡片",
		title: "New Card",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.cardEdit,
		label: "编辑卡片",
		title: "Edit Card",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.cardDetail,
		label: "卡片详情",
		title: "Card",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.image,
		label: "图片",
		title: "Images",
		desc: "图片管理",
		nav: true,
	},
	{
		path: PATHS.db,
		label: "数据库",
		title: "Database",
		desc: "管理员数据库查看",
		nav: true,
	},
	{
		path: PATHS.rainbow,
		label: "彩虹生成器",
		title: "Rainbow",
		desc: "Rainbow Generator",
		nav: true,
	},
	{
		path: PATHS.text,
		label: "文本编辑",
		title: "Text",
		desc: "多标签纯文本编辑器",
		nav: true,
	},
	{
		path: PATHS.reading,
		label: "英语阅读",
		title: "Reading",
		desc: "英语阅读与单词管理",
		nav: true,
	},
	{
		path: PATHS.readingUnknown,
		label: "不认识词表",
		title: "Unknown Words",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.bookmark,
		label: "书签",
		title: "Bookmarks",
		desc: "网页书签管理",
		nav: true,
	},
	{
		path: PATHS.bookmarkDetail,
		label: "书签详情",
		title: "Bookmark",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.bookmarkManage,
		label: "书签管理",
		title: "Bookmark Manage",
		desc: "书签批量管理",
		nav: false,
	},
	{
		path: PATHS.readingDetail,
		label: "阅读文章",
		title: "Reading",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.memory,
		label: "记忆",
		title: "Memory",
		desc: "间隔重复记忆系统",
		nav: true,
	},
	{
		path: PATHS.memoryAdd,
		label: "添加记忆",
		title: "New Mem",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.memoryManage,
		label: "记忆管理",
		title: "Manage",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.conversation,
		label: "知识搜索",
		title: "Knowledge",
		desc: "搜索概念与文章",
		nav: true,
	},
	{
		path: PATHS.convDetail,
		label: "知识详情",
		title: "Knowledge Item",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.convConcept,
		label: "概念详情",
		title: "Concept",
		desc: "",
		nav: false,
	},
	{
		path: PATHS.chat,
		label: "AI 对话",
		title: "AI Chat",
		desc: "多轮对话，树状分支，修改上下文",
		nav: true,
	},
	{
		path: PATHS.chatPrompts,
		label: "提示词预设",
		title: "Prompts",
		desc: "管理自定义提示词预设",
		nav: true,
	},
	{
		path: PATHS.chatMem,
		label: "记忆卡片生成",
		title: "Mem Cards",
		desc: "对话式生成记忆卡片",
		nav: true,
	},
	{
		path: PATHS.admin,
		label: "管理员设置",
		title: "Admin",
		desc: "开放注册 / JWT 密钥管理（仅管理员）",
		nav: true,
	},
	{
		path: PATHS.key,
		label: "API Key",
		title: "API Key",
		desc: "生成 API key（测试认证）",
		nav: true,
	},
];

/** 导航入口（显示在命令面板中） */
export const NAV_ROUTES = NAV_ITEMS.filter((r) => r.nav);
