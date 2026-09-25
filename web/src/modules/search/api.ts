// ── /search 的 API 面（薄门面）──
//
// 站内搜索的检索能力**属于 `command-palette` 模块**（命令面板与搜索页共用同一套
// 后端检索与命中解析，见 `modules/command-palette/index.ts` 的注释）。本模块只做
// 结果页的呈现，所以这里不再写第二套调用，只把"页面用到的那些"从那边转出来 ——
// 好处是页面不再直接引另一个模块，检索面要换实现时改这一处即可。

export {
	KIND_LABEL,
	resolveTargetUrl,
	type SearchHit,
	searchE,
} from "@modules/command-palette";
