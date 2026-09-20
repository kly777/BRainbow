// 站内搜索（/search 页）与命令面板共用同一套后端检索与命中解析：它们属于这个模块
// 的对外能力，因此经 barrel 导出 —— 消费方不必深入 api.ts / hooks/suggestions.ts
//（文档 P2-4 记录过这处跨模块边界泄漏）
export { type SearchHit, searchE } from "./api.ts";
export { default as CommandPalette } from "./CommandPalette.tsx";
export { KIND_LABEL, resolveTargetUrl } from "./hooks/suggestions.ts";
