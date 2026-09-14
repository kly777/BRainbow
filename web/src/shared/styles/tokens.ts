/**
 * tokens.ts — TS 侧读取设计令牌的**唯一入口**
 *
 * 为什么需要它：CSS 里 `var(--t-color-*)` 由浏览器解析，写错名字在构建期没有任何
 * 提示；而 TS 侧（Canvas、图表等拿不到 CSS 的地方）只能靠 `getComputedStyle` 自己
 * 去读，读的名字是**手写字符串**。任务依赖图就栽在这里：`dag-render.ts` 读的 5 个
 * 变量名（`--color-border` / `--color-text` / `--color-white` / `--color-text-secondary`
 * / `--color-text-muted`）在本项目一个都不存在（项目令牌统一 `--t-color-*`），
 * `getPropertyValue` 返回空串，而 Canvas 对非法颜色赋值是**静默忽略**——
 * 于是边、箭头、节点、图例全部退化成默认黑，构建、lint、测试全都不报。
 *
 * 因此这里把「JS 侧允许读取的令牌」登记成一个字面量联合类型：写错名字是**编译错误**，
 * 不再是静默空串。配套 `tokens-contract.test.ts` 断言这些名字在 CSS 里真实定义，
 * 防止联合类型与 tokens.css 漂移。
 *
 * 新增令牌的正确顺序：① tokens.css 里定义 → ② 加入本文件 TOKEN_NAMES。
 * 只登记 JS 真的需要读的那些，不是把全部令牌抄一遍。
 */

export const TOKEN_NAMES = [
	"--t-color-border",
	"--t-color-ink",
	"--t-color-ink-muted",
	"--t-color-ink-faint",
	"--t-color-ink-strong",
	"--t-color-surface",
	"--t-color-on-solid",
	"--t-color-accent",
	"--t-color-success",
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/**
 * 缓存键带主题：`data-theme` 由 applyTheme 落成具体主题（auto 已被 resolveTheme
 * 解析），所以换主题后键不同、不会取到上一个主题的颜色。
 */
const cache = new Map<string, string>();

/** 读取令牌的**计算值**（如 `oklch(24% 0.008 80deg)`）；取不到返回空串 */
export function readToken(name: TokenName): string {
	// vitest 默认 node 环境没有 document：返回空串且不写缓存，
	// 否则会把空值缓存下来污染后续（同进程 jsdom）用例
	if (typeof document === "undefined") return "";

	const theme = document.documentElement.dataset.theme ?? "";
	const key = `${theme}|${name}`;
	const cached = cache.get(key);
	if (cached !== undefined) return cached;

	const value = getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
	cache.set(key, value);
	return value;
}
