// ── 分层依赖方向契约 ──
//
// 为什么静态扫描而不是渲染测试：依赖方向是"源码里有没有这行 import"的性质，
// 渲染任何组件都观察不到它——越界引用照样能渲染出正确的画面。只能读源码。
//
// 方向（见 AGENTS.md 的架构契约与 doc/component-design.md §1）：
//
//     app ──→ modules ──→ components ──→ shared        config 是零依赖旁路
//
// 本测试钉五条：
//  1. `components/**` 不得引 `@modules/**`——共享层不反向依赖业务模块；
//  2. `shared/**` 不得引 `@components/**`——工具层与 API 层不依赖 UI
//     （两个全局 store 迄今住在 components/ui/organisms/ 下，是历史遗留）；
//  3. `modules/A/**` 不得深引 `modules/B/**` 的内部（B ≠ A），只许 `@modules/B` barrel；
//  4. `config/**` 零依赖（不得引其余四层中的任何一个）；
//  5. `components/**` 与 `shared/**` 不得引 `@app/**`——它们要能脱离应用外壳独立成立。
//
// 注意 `modules/**` 引 `@app/context/auth.tsx` 是**刻意允许**的（auth 上下文是环境，
// modules/auth/model.tsx 的注释写明"新代码直接从 @app/context/auth 引"），
// 所以这条规则只覆盖 components 与 shared，别顺手扩大到 modules。
//
// 存量越界记在 ALLOWED 白名单里，逐文件、逐 import 精确登记并附理由；
// 白名单条目一旦不再被用到（越界已修）本测试会失败，逼着人删掉——不会烂在那里。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

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

/** 该文件属于哪一层（以及 modules 的哪个域） */
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
		case "modules":
			return parts[1]
				? { kind: "modules", domain: parts[1] }
				: { kind: "other" };
		default:
			return { kind: "other" };
	}
}

/**
 * 存量越界白名单：`相对 src 的路径` → 允许的目标。
 * 只能登记"当前真实存在"的越界；修掉一处就删一条（否则下面的过期检查会失败）。
 */
const ALLOWED: Record<string, string[]> = {
	// 共享层的编辑器要能"上传 / 从文件库挑文件"，为此直接深入了 file 模块。
	// 修法：改成注入的 props（onUpload / onPickFile），实现由页面侧提供。
	"components/MarkdownEditor.tsx": [
		"@modules/file/api",
		"@modules/file/components/FilePickerModal.tsx",
	],
	// 401/403 全局处理要弹 toast，而 toastStore 住在 UI 层——这里用动态 import
	// 绕开静态循环。修法：store 下沉到 shared/ 后改成静态 import。
	"shared/api/request.ts": ["@components/ui"],
	"shared/utils/notify.ts": ["@components/ui/organisms/toastStore.ts"],
	"shared/utils/safe-action.ts": ["@components/ui/organisms/confirmStore.ts"],
	// 把请求错误抛成 toast 的默认路径，同样依赖 UI 层的 store（同上）。
	"shared/api/types/errors.ts": ["@components/ui/organisms/toastStore.ts"],
};

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

/** 判这条引用是否越界；返回 null 表示合法 */
function violationOf(
	layer: Layer,
	spec: string,
): { rule: string; why: string } | null {
	if (!spec.startsWith("@")) return null; // 相对路径：同目录内引用，不跨层

	if (layer.kind === "components") {
		if (spec === "@modules" || spec.startsWith("@modules/")) {
			return { rule: "1", why: "共享层不得引业务模块" };
		}
		if (spec === "@app" || spec.startsWith("@app/")) {
			return { rule: "5", why: "共享层不得引应用外壳（要能独立成立）" };
		}
	}

	if (layer.kind === "shared") {
		if (spec === "@components" || spec.startsWith("@components/")) {
			return { rule: "2", why: "shared 层不得引 UI 层" };
		}
		if (spec === "@app" || spec.startsWith("@app/")) {
			return { rule: "5", why: "shared 层不得引应用外壳" };
		}
	}

	if (layer.kind === "config") {
		if (/^@(app|modules|components|shared)(\/|$)/.test(spec)) {
			return { rule: "4", why: "config 是零依赖旁路" };
		}
	}

	if (layer.kind === "modules") {
		const m = spec.match(/^@modules\/([^/]+)(\/.*)?$/);
		// 只认"有第二段路径"的深引；`@modules/<域>` 是 barrel，正是要鼓励的
		if (m?.[2] && m[1] !== layer.domain) {
			return {
				rule: "3",
				why: `跨模块深引内部实现，应改从 @modules/${m[1]} 导入`,
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
	it("没有越层引用（存量债见 ALLOWED 白名单）", () => {
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
});
