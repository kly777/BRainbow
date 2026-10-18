// ── 分层依赖方向契约 ──
//
// 为什么静态扫描而不是渲染测试：依赖方向是"源码里有没有这行 import"的性质，
// 渲染任何组件都观察不到它——越界引用照样能渲染出正确的画面。只能读源码。
//
// 方向（见 AGENTS.md 的架构契约与 doc/guides/component-design.md §1）：
//
//     app ──→ modules ──→ components ──→ shared        config 是零依赖旁路
//
// 本测试钉五条：
//  1. `components/**` 不得引 `@modules/**`——共享层不反向依赖业务模块；
//  2. `shared/**` 不得引 `@components/**`——工具层与 API 层不依赖 UI
//     （两个全局 store 迄今住在 components/ui/organisms/ 下，是历史遗留）；
//  3. `modules/A/**` 不得深引 `modules/B/**` 的**子目录**（components / hooks / lib /
//     viewers …）——那是 B 的内部实现，跨模块一律走 `@modules/B` barrel；
//     但**根级文件是公开入口**（页面、`api.ts`、root 支撑件），可以按路径引用：
//     路由表就是这么引页面的（`app/routes.ts` → `@modules/file/FileList.tsx`），
//     迁移手册也要求测试 mock 叶子 `@modules/<域>/api.ts` 而不是 barrel；
//  4. `config/**` 零依赖（不得引其余四层中的任何一个）；
//  5. `components/**` 与 `shared/**` 不得引 `@app/**`——它们要能脱离应用外壳独立成立。
//
// 注意 `modules/**` 引 `@app/context/auth.tsx` 是**刻意允许**的（auth 上下文是环境，
// modules/auth/model.tsx 的注释写明"新代码直接从 @app/context/auth 引"），
// 所以这条规则只覆盖 components 与 shared，别顺手扩大到 modules。
//
// 存量越界记在 ALLOWED 白名单里，逐文件、逐 import 精确登记并附理由；
// 白名单条目一旦不再被用到（越界已修）本测试会失败，逼着人删掉——不会烂在那里。

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
	MODULE_KINDS,
	MODULE_LAYER_DIRS,
	type ModuleKind,
} from "@config/module-registry.ts";
import { describe, expect, it } from "vite-plus/test";

// vitest 从 web/ 启动（pnpm run test），与 css-modules-contract.test.ts 的假设一致
const SRC_ROOT = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else out.push(p);
	}
	return out;
}

const MODULE_LAYER_ROOTS = Object.values(MODULE_LAYER_DIRS);
const MODULE_ROOTS = MODULE_LAYER_ROOTS.map((dir) => join(SRC_ROOT, dir));

/** 所有模块文件；层级目录是物理的，模块名 = 层目录下一级 */
function moduleFiles(): string[] {
	return MODULE_ROOTS.flatMap((root) => walk(root));
}

/** 物理路径 → 模块名（`domains/task/...` → `task`） */
function moduleNameOf(file: string): string | null {
	const rel = relative(SRC_ROOT, file).split("\\").join("/");
	const [layer, name] = rel.split("/");
	return MODULE_LAYER_ROOTS.includes(layer) && name ? name : null;
}

/** 所有模块目录（名字 + 物理根） */
function moduleDirs(): { name: string; root: string }[] {
	return MODULE_ROOTS.flatMap((root) =>
		readdirSync(root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => ({ name: entry.name, root: join(root, entry.name) })),
	);
}

/** 该文件属于哪一层（以及模块名） */
type Layer =
	| { kind: "app" }
	| { kind: "components" }
	| { kind: "shared" }
	| { kind: "config" }
	| { kind: "modules"; domain: string }
	| { kind: "other" };

function layerOf(relPath: string): Layer {
	const parts = relPath.split("/");
	switch (parts[0]) {
		case "app":
			return { kind: "app" };
		case "components":
			return { kind: "components" };
		case "shared":
			return { kind: "shared" };
		case "config":
			return { kind: "config" };
		case "domains":
		case "capabilities":
		case "platform":
		case "tools":
			return parts[1]
				? { kind: "modules", domain: parts[1] }
				: { kind: "other" };
		default:
			return { kind: "other" };
	}
}

/**
 * 存量越界白名单：`相对 src 的路径` → 允许的目标。**当前为空**——曾经的两处
 * （store 住在 UI 层导致的 shared → components、MarkdownEditor 硬引 file 模块）
 * 都已经在源头修掉。留着这个机制是为了让将来必须落地的例外有地方登记：
 * 只能登记"当前真实存在"的越界，修掉一处就删一条（否则过期检查会失败），
 * 所以它不会烂在那里变成永久豁免。
 */
const ALLOWED: Record<string, string[]> = {};

/** 抓 `from "…"` 与动态 `import("…")` 两类引用（不含注释里的提及） */
function specifiersOf(source: string): string[] {
	const out: string[] = [];
	for (const re of [
		/from\s+["']([^"']+)["']/g,
		/import\(\s*["']([^"']+)["']\s*\)/g,
	]) {
		for (const m of source.matchAll(re)) out.push(m[1]);
	}
	return out;
}

const MODULE_ALIAS_PREFIXES = [
	"@modules",
	...MODULE_LAYER_ROOTS.map((d) => `@${d}`),
];

/** 解析 `@modules/x/...` 或 `@domains/x/...` 形式的模块引用 */
function moduleRefOf(spec: string): { name: string; rest: string } | null {
	for (const prefix of MODULE_ALIAS_PREFIXES) {
		if (spec === prefix) return null;
		if (!spec.startsWith(`${prefix}/`)) continue;
		const [name, ...rest] = spec.slice(prefix.length + 1).split("/");
		return { name, rest: rest.join("/") };
	}
	return null;
}

function isModuleRef(spec: string): boolean {
	return MODULE_ALIAS_PREFIXES.some(
		(prefix) => spec === prefix || spec.startsWith(`${prefix}/`),
	);
}

/** 判这条引用是否越界；返回 null 表示合法 */
function violationOf(
	layer: Layer,
	spec: string,
): { rule: string; why: string } | null {
	if (!spec.startsWith("@")) return null; // 相对路径：同目录内引用，不跨层

	if (layer.kind === "components") {
		if (isModuleRef(spec)) {
			return { rule: "1", why: "共享层不得引业务模块" };
		}
		if (spec === "@app" || spec.startsWith("@app/")) {
			return { rule: "5", why: "共享层不得引应用外壳（要能独立成立）" };
		}
	}

	if (layer.kind === "shared") {
		if (isModuleRef(spec)) {
			return { rule: "2", why: "shared 层不得引模块层" };
		}
		if (spec === "@components" || spec.startsWith("@components/")) {
			return { rule: "2", why: "shared 层不得引 UI 层" };
		}
		if (spec === "@app" || spec.startsWith("@app/")) {
			return { rule: "5", why: "shared 层不得引应用外壳" };
		}
	}

	if (layer.kind === "config") {
		if (
			/^@(app|modules|components|shared|domains|capabilities|platform|tools)(\/|$)/.test(
				spec,
			)
		) {
			return { rule: "4", why: "config 是零依赖旁路" };
		}
	}

	if (layer.kind === "modules") {
		const ref = moduleRefOf(spec);
		// 目标路径里还有 "/" → 落在子目录（components/ view/ model/ data/ …）= 内部实现；
		// 根级文件（`FileList.tsx` / `api.ts` / `markdown-editor-support.tsx`）属公开入口
		if (ref && ref.name !== layer.domain && ref.rest.includes("/")) {
			return {
				rule: "3",
				why: `跨模块深引内部实现，应改从 @modules/${ref.name} 导入或使用它的根级入口`,
			};
		}
	}

	return null;
}

function lineOf(source: string, index: number): number {
	let line = 1;
	for (let i = 0; i < index; i++) if (source[i] === "\n") line++;
	return line;
}

describe("分层依赖方向契约", () => {
	it("没有越层引用（当前零例外；例外必须登记进 ALLOWED 并附理由）", () => {
		const files = walk(SRC_ROOT).filter(
			(f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.includes(".test."),
		);

		const violations: string[] = [];
		const usedAllowed = new Set<string>();

		for (const f of files) {
			const relPath = relative(SRC_ROOT, f).split("\\").join("/");
			const layer = layerOf(relPath);
			if (layer.kind === "other") continue;
			const source = readFileSync(f, "utf8");
			const allow = ALLOWED[relPath] ?? [];

			for (const spec of specifiersOf(source)) {
				const v = violationOf(layer, spec);
				if (!v) continue;
				if (allow.includes(spec)) {
					usedAllowed.add(`${relPath} ${spec}`);
					continue;
				}
				const at = source.indexOf(spec);
				violations.push(
					`${relPath}:${lineOf(source, at < 0 ? 0 : at)}  规则 ${v.rule}：${spec}（${v.why}）`,
				);
			}
		}

		if (violations.length > 0) {
			throw new Error(
				`分层依赖方向被违反 ${violations.length} 处：\n${violations
					.map((v) => `  ${v}`)
					.join("\n")}`,
			);
		}

		// 白名单自我清理：越界修掉后条目必须删除，否则它会在下一次越界时静默放行
		const stale: string[] = [];
		for (const [file, specs] of Object.entries(ALLOWED)) {
			for (const spec of specs) {
				if (!usedAllowed.has(`${file} ${spec}`)) {
					stale.push(`${file} → ${spec}`);
				}
			}
		}
		if (stale.length > 0) {
			throw new Error(
				`白名单已过期 ${stale.length} 条（该越界已不存在，请从 ALLOWED 里删掉）：\n${stale
					.map((s) => `  ${s}`)
					.join("\n")}`,
			);
		}

		expect(violations.length).toBe(0);
	});

	it("所有模块都有类型，且有公共入口", () => {
		const dirs = moduleDirs();
		const registered = Object.keys(MODULE_KINDS).sort();

		expect(registered).toEqual(dirs.map((entry) => entry.name).sort());
		for (const { name, root } of dirs) {
			expect(relative(SRC_ROOT, dirname(root)).split("\\").join("/")).toBe(
				MODULE_LAYER_DIRS[MODULE_KINDS[name]],
			);
			expect(existsSync(join(root, "index.ts"))).toBe(true);
			// 分层统一：纯规则进 model/，页面状态进 view/；不再有 hooks/ 与 lib/ 两个大杂烩
			expect(
				existsSync(join(root, "hooks")),
				`${name}/hooks 应迁移到 view/`,
			).toBe(false);
			expect(existsSync(join(root, "lib")), `${name}/lib 应迁移到 model/`).toBe(
				false,
			);
		}
	});

	it("模块类型依赖方向：domain 不依赖 capability，platform/tool 不编排业务", () => {
		const forbidden: Partial<Record<ModuleKind, readonly ModuleKind[]>> = {
			domain: ["capability"],
			platform: ["domain", "capability"],
			tool: ["domain", "capability", "platform"],
		};
		const files = moduleFiles().filter(
			(f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.includes(".test."),
		);

		const violations: string[] = [];
		for (const file of files) {
			const sourceName = moduleNameOf(file);
			if (!sourceName) continue;
			const rel = relative(SRC_ROOT, file).split("\\").join("/");
			const sourceKind = MODULE_KINDS[sourceName];
			if (!sourceKind) continue;
			const denied = forbidden[sourceKind] ?? [];
			const source = readFileSync(file, "utf8");
			for (const spec of specifiersOf(source)) {
				const match = spec.match(
					/^@(?:modules|domains|capabilities|platform|tools)\/([^/]+)/,
				);
				if (!match || match[1] === sourceName) continue;
				const targetKind = MODULE_KINDS[match[1]];
				if (!targetKind || !denied.includes(targetKind)) continue;
				violations.push(
					`${rel}: ${sourceKind} 模块不应依赖 ${targetKind} 模块 ${spec}`,
				);
			}
		}

		expect(violations).toEqual([]);
	});

	it("domain→domain 只允许登记契约，模块图无环", () => {
		// 同层隔离：domain 之间不应再有直接依赖；跨域组合走 capability/platform。
		const allowedDomainEdges = new Set<string>();
		const files = moduleFiles().filter(
			(f) => /\.tsx?$/.test(f) && !f.endsWith(".d.ts") && !f.includes(".test."),
		);
		const edges = new Map<string, Set<string>>();
		const domainViolations: string[] = [];

		for (const file of files) {
			const source = moduleNameOf(file);
			if (!source) continue;
			const rel = relative(SRC_ROOT, file).split("\\").join("/");
			for (const spec of specifiersOf(readFileSync(file, "utf8"))) {
				const match = spec.match(
					/^@(?:modules|domains|capabilities|platform|tools)\/([^/]+)/,
				);
				if (!match || match[1] === source || !MODULE_KINDS[match[1]]) continue;
				const target = match[1];
				if (!edges.has(source)) edges.set(source, new Set());
				edges.get(source)!.add(target);
				if (
					MODULE_KINDS[source] === "domain" &&
					MODULE_KINDS[target] === "domain" &&
					!allowedDomainEdges.has(`${source}->${target}`)
				) {
					domainViolations.push(`${source} -> ${target}（${rel}）`);
				}
			}
		}

		const cycles: string[] = [];
		const visiting = new Set<string>();
		const visited = new Set<string>();
		const walkGraph = (node: string, path: string[]) => {
			if (visiting.has(node)) {
				cycles.push([...path, node].join(" → "));
				return;
			}
			if (visited.has(node)) return;
			visiting.add(node);
			for (const next of edges.get(node) ?? []) {
				walkGraph(next, [...path, node]);
			}
			visiting.delete(node);
			visited.add(node);
		};
		for (const node of edges.keys()) walkGraph(node, []);

		expect(domainViolations).toEqual([]);
		expect(cycles).toEqual([]);
	});

	it("模块公共入口不转出内部 UI/view 实现", () => {
		const violations: string[] = [];
		for (const { name, root } of moduleDirs()) {
			const index = join(root, "index.ts");
			if (!existsSync(index)) continue;
			for (const line of readFileSync(index, "utf8").split("\n")) {
				if (/export \* from "\.\/(components|view)\//.test(line)) {
					violations.push(`${name}/index.ts: ${line.trim()}`);
				}
			}
		}
		expect(violations).toEqual([]);
	});

	it("view/components 不直接碰 transport，只能经 api.ts 或 data/", () => {
		const files = moduleFiles().filter(
			(f) =>
				/\.tsx?$/.test(f) &&
				!f.endsWith(".d.ts") &&
				!f.includes(".test.") &&
				/[\\/](view|components)[\\/]/.test(f),
		);
		const violations: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const spec of specifiersOf(source)) {
				if (
					spec === "@shared/api/request.ts" ||
					spec === "@shared/api/cache.ts" ||
					spec === "@shared/api/streaming.ts"
				) {
					violations.push(
						`${relative(SRC_ROOT, file)}: view 不应直接 import ${spec}`,
					);
				}
			}
		}
		expect(violations).toEqual([]);
	});
});
