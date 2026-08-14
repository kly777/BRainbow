// ── 页面路由路径（唯一来源，勿在其他地方硬编码路径字符串） ──
// 新增页面：在此定义 → navigation.ts 引用 → routes.ts 自动派生路由
// 父子路径：子路径由父路径常量拼接派生，避免重复写父段

const CARD = "/card";
const READING = "/reading";
const MEMORY = "/memory";
const CONVERSATION = "/conversation";
const CHAT = "/chat";

export const PATHS = {
	home: "/",
	task: "/task",
	ontology: "/ontology",
	card: CARD,
	cardDetail: `${CARD}/:id`,
	cardEdit: `${CARD}/edit/:id`,
	cardAdd: `${CARD}/add`,
	color: "/color",
	image: "/image",
	db: "/db",
	rainbow: "/rainbow",
	text: "/text",
	reading: READING,
	readingUnknown: `${READING}/unknown`,
	readingDetail: `${READING}/:id`,
	bookmark: "/bookmark",
	memory: MEMORY,
	memoryAdd: `${MEMORY}/add`,
	memoryManage: `${MEMORY}/manage`,
	conversation: CONVERSATION,
	convQa: `${CONVERSATION}/qa/:id`,
	convConcept: `${CONVERSATION}/concept/:id`,
	chat: CHAT,
	chatPrompts: `${CHAT}/prompts`,
	chatMem: `${CHAT}/mem`,
	key: "/key",
	admin: "/admin",
} as const;

export type PathKey = keyof typeof PATHS;

/** 将路径模式中的 :id 替换为实际值（如 fillPath(PATHS.readingDetail, 12) → /reading/12） */
export function fillPath(pattern: string, value: string | number): string {
	return pattern.replace(":id", String(value));
}
