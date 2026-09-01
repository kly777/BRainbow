/**
 * ui-inspect.ts — 前端适应性/无障碍静态审计脚本（道之计划主题 F）
 *
 * 检查项（与 doc/frontend-dao-plan.md 对齐）：
 *   1. px 字号使用（目标：仅物理像素白名单可保留）
 *   2. 尺寸类 px（width/max-width/min-width/max-height…）——应转 rem 或 min()
 *   3. !important 数量（E-2 门禁：仅 print/reduced-motion 例外）
 *   4. forced-colors / prefers-contrast 覆盖（tokens.css 必须包含）
 *   5. 固定 px 宽度（宽度/间距类）
 *   6. 关键令牌对比度（F-2：oklch → 相对亮度 → WCAG 对比度）
 *
 * 运行：node scripts/ui-inspect.ts（Node ≥22.6 原生 TS 支持）
 * 输出：基线报告 + 各阈值通过/未达。退出码非零 = 有硬性违规。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(
	path.dirname(new URL(import.meta.url).pathname),
	"..",
);
const SRC = path.join(ROOT, "src");

/** 递归收集 CSS 文件 */
function collectCss(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) {
			out.push(...collectCss(full));
		} else if (
			entry.endsWith(".module.css") ||
			entry === "global.css" ||
			entry === "tokens.css"
		) {
			out.push(full);
		}
	}
	return out;
}

/** 尺寸类 px 属性正则（排除 1-4px 边框/阴影/位移与媒体查询断点） */
const DIM_PX =
	/(?:width|height|min-width|max-width|min-height|max-height|padding|margin|gap|font-size|inset):\s*([0-9.]+)px/g;
/** 允许的物理像素（1-4px：边框/阴影/位移微装饰） */
const ALLOWED_SMALL_PX = new Set([1, 2, 3, 4]);

/** oklch(97.2% 0.004 80deg) / oklch(24% 0.008 80deg) → [L, C, H] */
function parseOklch(value: string): [number, number, number] | null {
	const m = value.match(
		/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)/,
	);
	if (!m) return null;
	const L = m[1].endsWith("%") ? Number(m[1].slice(0, -1)) / 100 : Number(m[1]);
	const C = Number(m[2]);
	const H = (Number(m[3]) * Math.PI) / 180;
	return [L, C, H];
}

/** oklch → 线性 sRGB 相对亮度（WCAG 计算用） */
function oklchToLuminance([L, C, H]: [number, number, number]): number {
	const a = C * Math.cos(H);
	const b = C * Math.sin(H);
	// OKLab → LMS
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = L - 0.0894841775 * a - 1.291485548 * b;
	const l = l_ ** 3;
	const m = m_ ** 3;
	const s = s_ ** 3;
	// LMS → 线性 sRGB
	const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
	const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
	const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
	return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

/** WCAG 对比度 */
function contrastRatio(a: number, b: number): number {
	const [hi, lo] = a > b ? [a, b] : [b, a];
	return (hi + 0.05) / (lo + 0.05);
}

interface ContrastCheck {
	label: string;
	fg: string;
	bg: string;
	min: number;
}

/** 从 tokens.css 提取指定主题块的令牌（按行扫描 :root[data-theme="X"] … 第一个 } 结束） */
function extractThemeTokens(text: string, theme: string): Map<string, string> {
	const tokens = new Map<string, string>();
	const start = text.indexOf(`:root[data-theme="${theme}"]`);
	if (start === -1) return tokens;
	const blockEnd = text.indexOf("}", start);
	const block = text.slice(start, blockEnd);
	for (const m of block.matchAll(/--([\w-]+):\s*([^;]+);/g)) {
		tokens.set(m[1].trim(), m[2].trim());
	}
	return tokens;
}

interface Report {
	files: number;
	dimPx: { file: string; line: number; value: string }[];
	important: number;
	importantFiles: string[];
	hasForcedColors: boolean;
	hasPrefersContrast: boolean;
	contrast: { theme: string; label: string; ratio: number; min: number }[];
}

function inspect(): Report {
	const files = collectCss(SRC);
	const report: Report = {
		files: files.length,
		dimPx: [],
		important: 0,
		importantFiles: [],
		hasForcedColors: false,
		hasPrefersContrast: false,
		contrast: [],
	};

	for (const file of files) {
		const rel = path.relative(ROOT, file);
		const text = readFileSync(file, "utf8");

		if (text.includes("@media (forced-colors: active)")) {
			report.hasForcedColors = true;
		}
		if (text.includes("@media (prefers-contrast: more)")) {
			report.hasPrefersContrast = true;
		}

		// !important 计数（仅统计声明值，含 print/reduced-motion 例外的生物，供门禁展示）
		const importantCount = (text.match(/!important/g) ?? []).length;
		if (importantCount > 0) {
			report.important += importantCount;
			report.importantFiles.push(`${rel} (${importantCount})`);
		}

		// 尺寸类 px
		const lines = text.split("\n");
		lines.forEach((line, idx) => {
			for (const m of line.matchAll(DIM_PX)) {
				const val = Number(m[1]);
				// 跳过物理像素白名单；媒体查询断点行（含 width <= NNpx）也跳过
				if (ALLOWED_SMALL_PX.has(val)) continue;
				if (line.includes("@media") && val >= 400) continue;
				report.dimPx.push({ file: rel, line: idx + 1, value: m[0] });
			}
		});
	}

	// F-2：三主题关键令牌对比度
	const tokensPath = path.join(SRC, "shared", "styles", "tokens.css");
	const tokensText = readFileSync(tokensPath, "utf8");
	const checks: ContrastCheck[] = [
		{ label: "正文 ink/bg", fg: "--t-color-ink", bg: "--t-color-bg", min: 4.5 },
		{
			label: "弱化 ink-muted/bg",
			fg: "--t-color-ink-muted",
			bg: "--t-color-bg",
			min: 4.5,
		},
		{
			label: "极弱 ink-faint/bg",
			fg: "--t-color-ink-faint",
			bg: "--t-color-bg",
			min: 3,
		},
		{
			label: "强调 accent/surface",
			fg: "--t-color-accent",
			bg: "--t-color-surface",
			min: 3,
		},
	];
	for (const theme of ["paper", "midnight", "ocean"]) {
		const tokens = extractThemeTokens(tokensText, theme);
		const lum = (name: string) => {
			const raw = tokens.get(name.slice(2));
			if (!raw) return null;
			const oklch = parseOklch(raw);
			return oklch ? oklchToLuminance(oklch) : null;
		};
		for (const c of checks) {
			const fgL = lum(c.fg);
			const bgL = lum(c.bg);
			if (fgL == null || bgL == null) continue;
			report.contrast.push({
				theme,
				label: c.label,
				ratio: contrastRatio(fgL, bgL),
				min: c.min,
			});
		}
	}
	return report;
}

function main() {
	const r = inspect();
	console.log("══════ ui-inspect 审计报告 ══════");
	console.log(`扫描 CSS 文件：${r.files}`);
	console.log("");

	// 1. forced-colors / prefers-contrast
	console.log("【强制颜色/高对比度覆盖】");
	console.log(
		`  forced-colors: ${r.hasForcedColors ? "✅ 已覆盖" : "❌ 缺失"}`,
	);
	console.log(
		`  prefers-contrast: ${r.hasPrefersContrast ? "✅ 已覆盖" : "❌ 缺失"}`,
	);

	// 2. !important 门禁
	console.log("");
	console.log("【!important 门禁（E-2）】");
	console.log(`  总数：${r.important}（允许 print/reduced-motion 例外）`);
	r.importantFiles.forEach((f) => console.log(`    ${f}`));
	const importantOk = r.importantFiles.every(
		(f) => f.includes("global.css") || f.includes("tokens.css"),
	);

	// 3. 尺寸类 px
	console.log("");
	console.log("【尺寸类 px（应转 rem / min()）】");
	if (r.dimPx.length === 0) {
		console.log("  ✅ 无尺寸类 px 残留（仅物理像素白名单）");
	} else {
		console.log(`  ⚠️ ${r.dimPx.length} 处：`);
		r.dimPx
			.slice(0, 30)
			.forEach((d) => console.log(`    ${d.file}:${d.line}  ${d.value}`));
		if (r.dimPx.length > 30) console.log(`    … 共 ${r.dimPx.length} 处`);
	}

	// 4. 对比度（F-2）
	console.log("");
	console.log("【关键令牌对比度（WCAG，F-2）】");
	const contrastFails: string[] = [];
	for (const c of r.contrast) {
		const pass = c.ratio >= c.min;
		const mark = pass ? "✅" : "❌";
		console.log(
			`  ${mark} ${c.theme.padEnd(8)} ${c.label.padEnd(22)} ${c.ratio.toFixed(2)} (≥${c.min})`,
		);
		if (!pass) contrastFails.push(`${c.theme}/${c.label}`);
	}

	// 汇总
	console.log("");
	const hardFail =
		!r.hasForcedColors || !r.hasPrefersContrast || contrastFails.length > 0;
	console.log(
		hardFail
			? `结论：❌ 存在硬性违规（${[
					!r.hasForcedColors ? "forced-colors 缺失" : "",
					!r.hasPrefersContrast ? "prefers-contrast 缺失" : "",
					contrastFails.length
						? `对比度未达标: ${contrastFails.join(", ")}`
						: "",
				]
					.filter(Boolean)
					.join("; ")}）`
			: `结论：${r.dimPx.length === 0 && importantOk ? "✅ 通过" : "⚠️ 有改善项（不阻塞）"}`,
	);
	process.exitCode = hardFail ? 1 : 0;
}

main();
