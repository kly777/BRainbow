// ── 令牌联合类型与 tokens.css 的同步契约 ──
//
// `readToken(name: TokenName)` 把"变量名写错"从静默空串变成编译错误，
// 但类型本身是手写清单，可能与 CSS 漂移。这里钉住同步关系：
//   TOKEN_NAMES 里每个名字都必须在 tokens.css / global.css 中真实定义。
// 反方向（CSS 里多定义）不需要断言——JS 不读就不必登记。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES } from "./tokens.ts";

const WEB_ROOT = process.cwd();
const STYLESHEETS = [
	join(WEB_ROOT, "src/shared/styles/tokens.css"),
	join(WEB_ROOT, "src/app/global.css"),
];

describe("令牌契约", () => {
	it("TOKEN_NAMES 的每个名字都在样式表里有定义", () => {
		const css = STYLESHEETS.map((f) => readFileSync(f, "utf8")).join("\n");
		const missing = TOKEN_NAMES.filter(
			(name) => !new RegExp(`${name}\\s*:`).test(css),
		);
		expect(missing).toEqual([]);
	});

	it("清单本身不重复", () => {
		expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
	});
});
