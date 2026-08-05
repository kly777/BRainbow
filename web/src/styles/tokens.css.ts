/**
 * vanilla-extract 类型化设计令牌
 *
 * 生成与 tokens.css 同名的全局 CSS 变量（--v2-bg 等），兼容现有组件；
 * 同时提供类型安全的 `vars` 对象，供 vanilla-extract 样式引用
 * （style({ background: vars.v2.surface }) —— 编译期校验，只能使用已定义令牌）。
 *
 * 迁移完成后可删除旧 tokens.css（本文件已生成同名变量）。
 */
import { createGlobalTheme } from "@vanilla-extract/css";

export const vars = createGlobalTheme(":root", {
	v2: {
		// ── 色彩（暖纸 + 目录绿） ──
		bg: "oklch(0.975 0.008 95)",
		surface: "oklch(0.99 0.004 95)",
		surfaceRaised: "oklch(0.95 0.012 95)",
		ink: "oklch(0.25 0.015 85)",
		inkMuted: "oklch(0.45 0.012 85)",
		inkFaint: "oklch(0.6 0.008 85)",
		border: "oklch(0.86 0.015 95)",
		borderStrong: "oklch(0.82 0.03 95)",
		accent: "oklch(0.52 0.1 165)",
		accentStrong: "oklch(0.42 0.11 165)",
		accentSoft: "oklch(0.93 0.03 165)",
		white: "oklch(1 0 0)",

		// ── 状态色（badge 色板） ──
		badgeNewBg: "oklch(0.93 0.04 270)",
		badgeNewText: "oklch(0.45 0.18 270)",
		badgeLearningBg: "oklch(0.93 0.07 65)",
		badgeLearningText: "oklch(0.45 0.15 60)",
		badgeReviewBg: "oklch(0.93 0.06 150)",
		badgeReviewText: "oklch(0.4 0.12 150)",
		badgeSuspendedBg: "oklch(0.93 0 0)",
		badgeSuspendedText: "oklch(0.5 0 0)",
		badgeRelearningBg: "oklch(0.93 0.06 20)",
		badgeRelearningText: "oklch(0.42 0.15 20)",

		// ── 危险色 ──
		danger: "oklch(0.55 0.2 25)",
		dangerSubtle: "oklch(0.96 0.015 25)",

		// ── 成功色 ──
		success: "oklch(0.55 0.17 160)",
		successSubtle: "oklch(0.95 0.03 160)",

		// ── 警告色 ──
		warning: "oklch(0.6 0.16 85)",
		warningSubtle: "oklch(0.96 0.03 85)",

		// ── 字体 ──
		fontDisplay: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
		fontMono:
			"ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	},
});

// ── 布局常量（编译时值，非 CSS 变量） ──
export const space = {
	xs: "4px",
	sm: "8px",
	md: "12px",
	lg: "16px",
	xl: "24px",
} as const;

export const radius = {
	sm: "4px",
	md: "8px",
	lg: "12px",
} as const;

export const textSize = {
	xs: "11px",
	sm: "13px",
	base: "15px",
	lg: "18px",
	xl: "22px",
} as const;
