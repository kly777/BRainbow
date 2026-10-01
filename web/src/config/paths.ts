// ── 页面路由路径（唯一来源，勿在其他地方硬编码路径字符串） ──
// 新增页面：在此定义 → navigation.ts 引用 → routes.ts 自动派生路由
// 父子路径：子路径由父路径常量拼接派生，避免重复写父段

const CARD = "/card";
const READING = "/reading";
const MEMORY = "/memory";
const CONVERSATION = "/conversation";
const CHAT = "/chat";
const FILE = "/file";

export const PATHS = {
	home: "/",
	search: "/search",
	task: "/task",
	taskDetail: "/task/:id",
	ontology: "/ontology",
	ontologyDetail: "/ontology/:id",
	card: CARD,
	cardDetail: `${CARD}/:id`,
	cardEdit: `${CARD}/edit/:id`,
	cardAdd: `${CARD}/add`,
	color: "/color",
	file: FILE,
	fileDetail: `${FILE}/:id`,
	db: "/db",
	rainbow: "/rainbow",
	text: "/text",
	reading: READING,
	readingUnknown: `${READING}/unknown`,
	readingDetail: `${READING}/:id`,
	bookmark: "/bookmark",
	bookmarkManage: "/bookmark/manage",
	bookmarkDetail: "/bookmark/:id",
	memory: MEMORY,
	memoryAdd: `${MEMORY}/add`,
	memoryManage: `${MEMORY}/manage`,
	conversation: CONVERSATION,
	convDetail: `${CONVERSATION}/detail/:id`,
	convConcept: `${CONVERSATION}/concept/:id`,
	chat: CHAT,
	chatPrompts: `${CHAT}/prompts`,
	chatMem: `${CHAT}/mem`,
	key: "/key",
	admin: "/admin",
} as const;

export type PathKey = keyof typeof PATHS;
/** 所有实际路径字符串（PATHS 值联合），用于给导航/路由表做编译期穷尽检查 */
export type PathValue = (typeof PATHS)[PathKey];

/** 将路径模式中的 :id 替换为实际值（如 fillPath(PATHS.readingDetail, 12) → /reading/12） */
export function fillPath(pattern: string, value: string | number): string {
	return pattern.replace(":id", String(value));
}

/**
 * 这是不是一条**可直接跳转的实路径**：带占位段的模板（`/file/:id`、`/card/edit/:id`）
 * 不是 —— 跳过去只会得到坏页面。
 *
 * 凡"拿来就跳"的清单都要先过它：命令面板的 `/` 导航（此前把 `/file/:id` 这类模板
 * 也当候选搜出来，选中后跳到字面量路径）、最近访问之类。要有具体某个文件/卡片，
 * 那是站内搜索（`?`）的活。
 */
export function isConcretePath(path: string): boolean {
	return !path.includes(":");
}
