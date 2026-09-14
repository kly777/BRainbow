// ── CSS Module 类名引用契约 ──
//
// 为什么用静态扫描而不是渲染测试：vitest 默认不处理 CSS（css: false），
// `*.module.css` 的导入会被替换成一个 Proxy——访问**任意**属性都返回
// `_<属性名>_<hash>`。于是 `styles["filter-btn"]` 在 jsdom 里照样拿得到值
// （哪怕构建产物里 camelCaseOnly 只导出 `filterBtn` 键，取 kebab 是 undefined），
// 任何渲染测试都不可能发现这类错误。只能读源码与 CSS 文本做比对。
//
// 本测试钉三条规则（均为仓库真实踩过的坑）：
//  1. 禁止 `styles[动态索引]`——键不是字面量时既查不了存在性，也读不懂意图；
//  2. 禁止 `styles["kebab-name"]`——vite 配了 `localsConvention: "camelCaseOnly"`，
//     导出对象里只有 camelCase 键，kebab 索引静默求值为 undefined
//     （/search 页的筛选条与结果样式曾因此整块失效，见 doc/frontend-ui-architecture.md）；
//  3. `styles.someKey` 的 key 必须在对应 CSS 里真实存在——错别字
//     （如 hitTitl）同样是静默 undefined。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// vitest 从 web/ 启动（pnpm run test），与 scripts/generate-seo.ts 的相对路径假设一致
const SRC_ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

/** CSS 文本 → 类名集合（先去注释，防止注释里的类名干扰） */
function cssClassNames(css: string): Set<string> {
	const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const names = new Set<string>();
	// 只认字母/下划线开头的类名；数字开头（如 0.5rem）天然不匹配
	for (const m of noComments.matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
		names.add(m[1]);
	}
	return names;
}

/** kebab → camelCase，与 localsConvention: "camelCaseOnly" 的导出键一致 */
function camelize(name: string): string {
	return name.replace(/-+([A-Za-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** 某文件第 index 字符所在的行号（1 起） */
function lineOf(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
	return line;
}

interface Violation {
	where: string;
	reason: string;
}

describe("CSS Module 类名引用契约", () => {
	it("所有 styles.* / styles[...] 引用的键都被对应 CSS 真实导出", () => {
		const files = walk(SRC_ROOT);
		const cssFiles = files.filter((f) => f.endsWith(".module.css"));
		const tsFiles = files.filter(
			(f) =>
				(/\.tsx?$/.test(f) || /\.ts$/.test(f)) &&
				!f.endsWith(".d.ts") &&
				!f.includes(".test."),
		);

		// basename（如 Button.module.css）→ 路径列表；同名时按"同目录优先"解析
		const cssByBasename = new Map<string, string[]>();
		for (const f of cssFiles) {
			const base = f.split("/").pop() as string;
			const list = cssByBasename.get(base) ?? [];
			list.push(f);
			cssByBasename.set(base, list);
		}
		const exportedKeys = new Map<string, Set<string>>();
		for (const f of cssFiles) {
			const keys = new Set<string>();
			for (const c of cssClassNames(readFileSync(f, "utf8")))
				keys.add(camelize(c));
			exportedKeys.set(f, keys);
		}

		const violations: Violation[] = [];
		const importRe =
			/import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+\.module\.css)["']/g;

		for (const ts of tsFiles) {
			const source = readFileSync(ts, "utf8");
			for (const imp of source.matchAll(importRe)) {
				const binding = imp[1];
				const spec = imp[2];
				const at = imp.index ?? 0;
				const base = spec.split("/").pop() as string;
				const candidates = cssByBasename.get(base) ?? [];
				if (candidates.length === 0) {
					violations.push({
						where: `${ts}:${lineOf(source, at)}`,
						reason: `import 了 ${base}，但扫描器没找到这个 CSS 文件（路径别名解析不了？）`,
					});
					continue;
				}
				const dir = ts.slice(0, ts.lastIndexOf("/"));
				const resolved =
					candidates.find((c) => c.slice(0, c.lastIndexOf("/")) === dir) ??
					candidates[0];
				const keys = exportedKeys.get(resolved) as Set<string>;

				// 负向后顾排除 props.styles.xxx 这类成员链（当前仓库没有，防将来）
				const propRe = new RegExp(
					`(?<![\\w$.])${binding}\\.([A-Za-z_$][\\w$]*)`,
					"g",
				);
				for (const m of source.matchAll(propRe)) {
					if (!keys.has(m[1])) {
						violations.push({
							where: `${ts}:${lineOf(source, m.index ?? 0)}`,
							reason: `${binding}.${m[1]} 在 ${base} 里不存在（导出键见该文件类名的 camelCase 形式）`,
						});
					}
				}

				// 中括号访问：字面量键要存在且不能是 kebab；非字面量即动态索引，一律禁
				const bracketRe = new RegExp(`(?<![\\w$.])${binding}\\[`, "g");
				for (const m of source.matchAll(bracketRe)) {
					const after = source.slice((m.index ?? 0) + binding.length + 1);
					const lit = after.match(/^(["'])([^"']*)\1\]/);
					if (!lit) {
						violations.push({
							where: `${ts}:${lineOf(source, m.index ?? 0)}`,
							reason: `${binding}[…] 是动态索引——键取值无法静态校验，请改用属性访问`,
						});
						continue;
					}
					const key = lit[2];
					if (key.includes("-")) {
						violations.push({
							where: `${ts}:${lineOf(source, m.index ?? 0)}`,
							reason: `${binding}["${key}"]：localsConvention 是 camelCaseOnly，kebab 键不被导出（取值为 undefined），应写 ${binding}.${camelize(key)}`,
						});
					} else if (!keys.has(key)) {
						violations.push({
							where: `${ts}:${lineOf(source, m.index ?? 0)}`,
							reason: `${binding}["${key}"] 在 ${base} 里不存在`,
						});
					}
				}
			}
		}

		if (violations.length > 0) {
			throw new Error(
				`类名引用契约被违反 ${violations.length} 处：\n${violations
					.map((v) => `  ${v.where.replace(SRC_ROOT + "/", "")}  ${v.reason}`)
					.join("\n")}`,
			);
		}
		expect(violations.length).toBe(0);
	});
});
