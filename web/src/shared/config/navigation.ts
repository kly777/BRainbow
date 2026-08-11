// ── 导航元数据（纯数据，无组件） ──

export interface NavItem {
	path: string;
	label: string;
	title: string;
	desc: string;
	nav: boolean;
}

export const NAV_ITEMS: NavItem[] = [
	{ path: "/", label: "主页", title: "Brainbow", desc: "首页面板", nav: true },
	{ path: "/t", label: "任务", title: "Tasks", desc: "任务管理", nav: true },
	{
		path: "/o",
		label: "本体",
		title: "Ontology",
		desc: "本体与符号系统",
		nav: true,
	},
	{
		path: "/c",
		label: "卡片",
		title: "Cards",
		desc: "知识卡片浏览",
		nav: true,
	},
	{
		path: "/color",
		label: "配色",
		title: "Color",
		desc: "全局主题配色切换",
		nav: true,
	},
	{
		path: "/c/add",
		label: "新建卡片",
		title: "New Card",
		desc: "",
		nav: false,
	},
	{ path: "/i", label: "图片", title: "Images", desc: "图片管理", nav: true },
	{
		path: "/db",
		label: "数据库",
		title: "Database",
		desc: "管理员数据库查看",
		nav: true,
	},
	{
		path: "/rg",
		label: "彩虹生成器",
		title: "Rainbow",
		desc: "Rainbow Generator",
		nav: true,
	},
	{
		path: "/text",
		label: "文本编辑",
		title: "Text",
		desc: "多标签纯文本编辑器",
		nav: true,
	},
	{
		path: "/reading",
		label: "英语阅读",
		title: "Reading",
		desc: "英语阅读与单词管理",
		nav: true,
	},
	{
		path: "/reading/unknown",
		label: "不认识词表",
		title: "Unknown Words",
		desc: "",
		nav: false,
	},
	{
		path: "/bookmark",
		label: "书签",
		title: "Bookmarks",
		desc: "网页书签管理",
		nav: true,
	},
	{
		path: "/reading/:id",
		label: "阅读文章",
		title: "Reading",
		desc: "",
		nav: false,
	},
	{
		path: "/m",
		label: "记忆",
		title: "Memory",
		desc: "间隔重复记忆系统",
		nav: true,
	},
	{ path: "/m/add", label: "添加记忆", title: "New Mem", desc: "", nav: false },
	{
		path: "/m/manage",
		label: "记忆管理",
		title: "Manage",
		desc: "",
		nav: false,
	},
	{
		path: "/conv",
		label: "对话搜索",
		title: "Conversations",
		desc: "搜索 AI 对话历史",
		nav: true,
	},
	{
		path: "/chat",
		label: "AI 对话",
		title: "AI Chat",
		desc: "多轮对话，树状分支，修改上下文",
		nav: true,
	},
	{
		path: "/chat/prompts",
		label: "提示词预设",
		title: "Prompts",
		desc: "管理自定义提示词预设",
		nav: true,
	},
	{
		path: "/chat/mem",
		label: "记忆卡片生成",
		title: "Mem Cards",
		desc: "对话式生成记忆卡片",
		nav: true,
	},
	{
		path: "/key",
		label: "API Key",
		title: "API Key",
		desc: "生成 API key（测试认证）",
		nav: true,
	},
];

/** 导航入口（显示在命令面板中） */
export const NAV_ROUTES = NAV_ITEMS.filter((r) => r.nav);
