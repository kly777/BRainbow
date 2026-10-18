// ── 前端模块分类（架构决策的可执行清单）──
//
// 这里只登记"模块是什么类型"，不登记它依赖谁；依赖权限由
// app/layer-boundaries.test.ts 按类型检查。新增模块必须在这里出现，
// 否则静态检查会因为"未分类模块"失败。

export type ModuleKind = "domain" | "capability" | "platform" | "tool";

export const MODULE_KINDS: Readonly<Record<string, ModuleKind>> = {
	// 业务域：只拥有自己的领域规则与数据
	bookmark: "domain",
	card: "domain",
	chat: "domain",
	conv: "domain",
	file: "domain",
	mem: "domain",
	ontology: "domain",
	reading: "domain",
	task: "domain",
	text: "domain",

	// 跨域能力：可以编排多个业务域，但不复制领域规则
	"command-palette": "capability",
	home: "capability",
	"quick-capture": "capability",
	search: "capability",

	// 平台能力：认证、设置、管理等应用级能力
	admin: "platform",
	"ai-setting": "platform",
	auth: "platform",
	db: "platform",
	key: "platform",

	// 独立小工具：不参与业务编排
	color: "tool",
	rainbow: "tool",
};
