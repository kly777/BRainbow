import type { RouteDefinition } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import { type Component, createEffect, lazy, onCleanup } from "solid-js";

export interface RouteConfig {
	path: string;
	label: string;
	desc: string;
	/** 是否为导航入口（显示在 / 命令面板中） */
	nav?: boolean;
	/** 页面标题（英文）。为空则仅显示「Brainbow」。动态标题在组件内用 document.title 覆盖 */
	title?: string;
	component: Component;
}

/** 提取 Router 需要的字段 */
export function toRouteDefs(config: RouteConfig[]): RouteDefinition[] {
	return config.map(({ path, component }) => ({ path, component }));
}

export const ROUTES: RouteConfig[] = [
	{
		path: "/",
		label: "主页",
		title: "Brainbow",
		desc: "首页面板",
		nav: true,
		component: lazy(() => import("@pages/HomeGuard.tsx")),
	},
	{
		path: "/t",
		label: "任务",
		title: "Tasks",
		desc: "任务管理",
		nav: true,
		component: lazy(() => import("@features/task/TaskManager.tsx")),
	},
	{
		path: "/o",
		label: "本体",
		title: "Ontology",
		desc: "本体与符号系统",
		nav: true,
		component: lazy(() => import("@pages/ontology/OntologyList.tsx")),
	},
	{
		path: "/c",
		label: "卡片",
		title: "Cards",
		desc: "知识卡片浏览",
		nav: true,
		component: lazy(() => import("@features/card/CardsList.tsx")),
	},
	{
		path: "/color",
		label: "配色",
		title: "Color",
		desc: "全局主题配色切换",
		nav: true,
		component: lazy(() => import("@pages/ColorPage.tsx")),
	},
	{
		path: "/c/add",
		label: "新建卡片",
		title: "New Card",
		desc: "",
		nav: false,
		component: lazy(() => import("@features/card/CardAdd.tsx")),
	},
	{
		path: "/c/:id",
		label: "卡片详情",
		title: "Card",
		desc: "",
		component: lazy(() => import("@features/card/CardDetail.tsx")),
	},
	{
		path: "/c/edit/:id",
		label: "编辑卡片",
		title: "Edit Card",
		desc: "",
		component: lazy(() => import("@features/card/CardEdit.tsx")),
	},
	{
		path: "/i",
		label: "图片",
		title: "Images",
		desc: "图片管理",
		nav: true,
		component: lazy(() => import("@pages/media/MediaList.tsx")),
	},
	{
		path: "/db",
		label: "数据库",
		title: "Database",
		desc: "管理员数据库查看",
		nav: true,
		component: lazy(() => import("@pages/DbViewer.tsx")),
	},
	{
		path: "/rg",
		label: "彩虹生成器",
		title: "Rainbow",
		desc: "Rainbow Generator",
		nav: true,
		component: lazy(() => import("@pages/RainbowGenerator.tsx")),
	},
	{
		path: "/text",
		label: "文本编辑",
		title: "Text",
		desc: "多标签纯文本编辑器",
		nav: true,
		component: lazy(() => import("@pages/TextEditor.tsx")),
	},
	{
		path: "/reading",
		label: "英语阅读",
		title: "Reading",
		desc: "英语阅读与单词管理",
		nav: true,
		component: lazy(() => import("@features/reading/ReadingList.tsx")),
	},
	{
		path: "/reading/unknown",
		label: "不认识词表",
		title: "Unknown Words",
		desc: "",
		nav: false,
		component: lazy(() => import("@features/reading/ReadingUnknown.tsx")),
	},
	{
		path: "/reading/:id",
		label: "阅读文章",
		title: "Reading",
		desc: "",
		nav: false,
		component: lazy(() => import("@features/reading/ReadingDetail.tsx")),
	},
	{
		path: "/m",
		label: "记忆",
		title: "Memory",
		desc: "间隔重复记忆系统",
		nav: true,
		component: lazy(() => import("@features/mem/MemPage.tsx")),
	},
	{
		path: "/m/add",
		label: "添加记忆",
		title: "New Mem",
		desc: "",
		nav: false,
		component: lazy(() => import("@features/mem/MemAdd.tsx")),
	},
	{
		path: "/m/manage",
		label: "记忆管理",
		title: "Manage",
		desc: "",
		nav: false,
		component: lazy(() => import("@features/mem/MemManage.tsx")),
	},
	{
		path: "/conv",
		label: "对话搜索",
		title: "Conversations",
		desc: "搜索 AI 对话历史",
		nav: true,
		component: lazy(() => import("@features/conv/ConvSearch.tsx")),
	},
	{
		path: "/conv/qa/:id",
		label: "对话详情",
		title: "Conversation",
		desc: "",
		component: lazy(() => import("@features/conv/ConvQa.tsx")),
	},
	{
		path: "/conv/concept/:id",
		label: "概念详情",
		title: "Concept",
		desc: "",
		component: lazy(() => import("@features/conv/ConvConcept.tsx")),
	},
	{
		path: "/conv/:id",
		label: "对话详情 (旧)",
		title: "Conversation",
		desc: "",
		component: lazy(() => import("@features/conv/ConvDetail.tsx")),
	},
];

/** 仅导航入口，用于命令面板 */
export const NAV_ROUTES = ROUTES.filter((r) => r.nav);

/** 将路由路径模式转为匹配用的正则 */
function pathToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const regexStr = escaped.replace(/:\w+/g, "[^/]+");
	return new RegExp(`^${regexStr}$`);
}

/** 根据当前路径查找匹配的路由配置 */
export function findRoute(path: string): RouteConfig | undefined {
	return ROUTES.find((r) => pathToRegex(r.path).test(path));
}

/**
 * 放在 Layout 中，根据当前路径自动设置页面标题。
 * 动态标题（如文章阅读页）可以在组件内覆盖：document.title = "..."
 */
export function RouteTitle() {
	const location = useLocation();
	createEffect(() => {
		const route = findRoute(location.pathname);
		const title = route?.title;
		document.title = title ? `${title} · Brainbow` : "Brainbow";
	});
	onCleanup(() => {});
	return null;
}
