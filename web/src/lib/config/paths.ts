// ── 页面路由路径（唯一来源，勿在其他地方硬编码路径字符串） ──
// 新增页面：在此定义 → navigation.ts 引用 → routes.ts 自动派生路由

export const PATHS = {
	home: "/",
	task: "/task",
	ontology: "/ontology",
	card: "/card",
	cardAdd: "/card/add",
	color: "/color",
	image: "/image",
	db: "/db",
	rainbow: "/rainbow",
	text: "/text",
	reading: "/reading",
	readingUnknown: "/reading/unknown",
	readingDetail: "/reading/:id",
	bookmark: "/bookmark",
	memory: "/memory",
	memoryAdd: "/memory/add",
	memoryManage: "/memory/manage",
	conversation: "/conversation",
	chat: "/chat",
	chatPrompts: "/chat/prompts",
	chatMem: "/chat/mem",
	key: "/key",
} as const;

export type PathKey = keyof typeof PATHS;
