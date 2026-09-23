// ── 补齐 jsdom 的缺口（是测试环境的问题，不是应用代码的问题） ──
//
// jsdom 没实现 `Range.getBoundingClientRect`，而 FindOverlay 靠它把"查找命中"
// 滚到视口 1/3 处。缺了这个方法，凡是渲染到它的测试都会抛
// `range.getBoundingClientRect is not a function` —— vitest 把它记成 unhandled
// error（既不是断言失败，也不好定位），整条 `pnpm run test` 于是**永远非零退出**，
// 门禁就废了。这里补一个零矩形桩：这些用例断言的是文案与选区，不校验像素位置。
//
// 同类缺口不要在这里越堆越多：能用标准属性表达的就改代码本身
// （例如 ImageLightbox 原先用 Element.scrollTo，jsdom 同样没有，改成
// scrollTop/scrollLeft 后语义不变、也不必加桩）。
if (typeof Range !== "undefined" && !Range.prototype.getBoundingClientRect) {
	Range.prototype.getBoundingClientRect = (): DOMRect =>
		({
			x: 0,
			y: 0,
			top: 0,
			left: 0,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			toJSON: () => ({}),
		}) as DOMRect;
}
