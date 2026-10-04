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

// ── 把 Web Storage 补回来（同样只是测试环境的问题） ──
//
// Node ≥ 26 自己在 globalThis 上定义了 `localStorage` / `sessionStorage`；没给
// `--localstorage-file` 时它们求值是 `undefined`，而 vitest 往 globalThis 搬 jsdom
// 的键时会跳过"已经存在"的，于是 jsdom 用例里这两个全局就是 undefined ——
// `localStorage.getItem()` 抛 "Cannot read properties of undefined"，报错点落在
// `beforeEach` 那行 `localStorage.clear()` 上，看着与被测代码毫无关系
// （实测 5 个文件 / 63 个用例，全都是这个原因）。
//
// `.nvmrc` 钉不住它：`package.json` 的 engines 是 `>=24`，Node 26 是合法安装，
// 而这条差异只在测试运行时才现形（构建与 dev server 都不碰 localStorage）。
//
// 补一个最小实现，而不是去够 jsdom 那份：vitest 的 jsdom 环境里
// `window === globalThis`、`document.defaultView === globalThis`，
// 真正的 jsdom window 对象根本拿不到。行为按浏览器来：字符串键值、无过期。
function memoryStorage(): Storage {
	const entries = new Map<string, string>();
	return {
		get length() {
			return entries.size;
		},
		clear: () => entries.clear(),
		getItem: (key) => entries.get(key) ?? null,
		key: (index) => [...entries.keys()][index] ?? null,
		removeItem: (key) => void entries.delete(key),
		setItem: (key, value) => void entries.set(key, String(value)),
	};
}

if (typeof window !== "undefined") {
	for (const key of ["localStorage", "sessionStorage"] as const) {
		if (!globalThis[key]) {
			Object.defineProperty(globalThis, key, {
				value: memoryStorage(),
				configurable: true,
				writable: true,
			});
		}
	}
}
