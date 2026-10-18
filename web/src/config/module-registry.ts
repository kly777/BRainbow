// ── 前端模块分类（架构决策的可执行清单）──
//
// 这里只登记"模块是什么类型"，不登记它依赖谁；依赖权限由
// app/layer-boundaries.test.ts 按类型检查。新增模块必须在这里出现，
// 否则静态检查会因为"未分类模块"失败。

export type ModuleKind = "domain" | "capability" | "platform" | "tool";

/** 物理层目录：分类不是标签，文件真的住在对应目录里 */
export const MODULE_LAYER_DIRS: Readonly<Record<ModuleKind, string>> = {
	domain: "domains",
	capability: "capabilities",
	platform: "platform",
	tool: "tools",
};

export const MODULE_KINDS: Readonly<Record<string, ModuleKind>> = {
	// 业务域：只拥有自己的领域规则与数据
	bookmark: "domain",
	card: "domain",
	conv: "domain",
	mem: "domain",
	ontology: "domain",
	reading: "domain",
	task: "domain",
	text: "domain",

	// 跨域能力：可以编排多个业务域，但不复制领域规则
	chat: "capability", // 对话树是能力，组合 AI 与 mem；不再被看作独立业务域
	home: "capability",
	"quick-capture": "capability",
	search: "capability",

	// 平台能力：认证、设置、管理、通用文件服务等应用级能力
	admin: "platform",
	"ai-setting": "platform",
	auth: "platform",
	"command-palette": "platform", // 命令面板是应用级入口，search 复用它
	db: "platform",
	file: "platform", // 通用文件服务没有下游业务依赖，作为平台被各域消费
	key: "platform",

	// 独立小工具：不参与业务编排
	color: "tool",
	rainbow: "tool",
};
