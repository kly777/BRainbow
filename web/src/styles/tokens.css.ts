/**
 * tokens.css.ts — 类型化设计令牌（主题化）
 *
 * `vars` 是主题契约（类型安全）：style({ background: vars.color.surface })
 * `paperTheme` / `midnightTheme` / `oceanTheme` 是三个主题方案，
 * 将对应类名挂到根元素即可切换（/color 页面）。
 * `space` / `radius` / `textSize` 是布局常量（不随主题变化）。
 */
import { createTheme, createGlobalTheme, createThemeContract, globalStyle } from "@vanilla-extract/css";

// ── 主题契约（变量骨架，组件只引用此对象） ──
export const vars = createThemeContract({
	color: {
		// 底色
		bg: null,
		surface: null,
		surfaceRaised: null,
		// 文字
		ink: null,
		inkMuted: null,
		inkFaint: null,
		// 边框
		border: null,
		borderStrong: null,
		// 强调（accent）
		accent: null,
		accentStrong: null,
		accentSoft: null,
		white: null,
		// 状态 badge
		badgeNewBg: null,
		badgeNewText: null,
		badgeLearningBg: null,
		badgeLearningText: null,
		badgeReviewBg: null,
		badgeReviewText: null,
		badgeSuspendedBg: null,
		badgeSuspendedText: null,
		badgeRelearningBg: null,
		badgeRelearningText: null,
		// 语义色
		danger: null,
		dangerSubtle: null,
		success: null,
		successSubtle: null,
		warning: null,
		warningSubtle: null,
	},
	font: {
		display: null,
		mono: null,
	},
});

// ── 主题 1：paper（暖纸 · 目录绿，默认） ──
export const paperTheme = createTheme(vars, {
	color: {
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
		danger: "oklch(0.55 0.2 25)",
		dangerSubtle: "oklch(0.96 0.015 25)",
		success: "oklch(0.55 0.17 160)",
		successSubtle: "oklch(0.95 0.03 160)",
		warning: "oklch(0.6 0.16 85)",
		warningSubtle: "oklch(0.96 0.03 85)",
	},
	font: {
		display: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
		mono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	},
});

// ── 主题 2：midnight（暗夜 · 墨绿） ──
export const midnightTheme = createTheme(vars, {
	color: {
		bg: "oklch(0.17 0.012 260)",
		surface: "oklch(0.21 0.014 260)",
		surfaceRaised: "oklch(0.27 0.016 260)",
		ink: "oklch(0.93 0.008 95)",
		inkMuted: "oklch(0.76 0.006 95)",
		inkFaint: "oklch(0.6 0.005 95)",
		border: "oklch(0.32 0.014 260)",
		borderStrong: "oklch(0.4 0.018 260)",
		accent: "oklch(0.68 0.12 165)",
		accentStrong: "oklch(0.76 0.12 165)",
		accentSoft: "oklch(0.3 0.05 165)",
		white: "oklch(1 0 0)",
		badgeNewBg: "oklch(0.32 0.05 270)",
		badgeNewText: "oklch(0.72 0.14 270)",
		badgeLearningBg: "oklch(0.34 0.06 65)",
		badgeLearningText: "oklch(0.76 0.11 60)",
		badgeReviewBg: "oklch(0.32 0.05 150)",
		badgeReviewText: "oklch(0.7 0.1 150)",
		badgeSuspendedBg: "oklch(0.3 0 0)",
		badgeSuspendedText: "oklch(0.65 0 0)",
		badgeRelearningBg: "oklch(0.34 0.06 20)",
		badgeRelearningText: "oklch(0.75 0.12 20)",
		danger: "oklch(0.7 0.16 25)",
		dangerSubtle: "oklch(0.32 0.05 25)",
		success: "oklch(0.72 0.12 160)",
		successSubtle: "oklch(0.3 0.04 160)",
		warning: "oklch(0.78 0.12 85)",
		warningSubtle: "oklch(0.34 0.05 85)",
	},
	font: {
		display: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
		mono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	},
});

// ── 主题 3：ocean（冷蓝 · 晴空） ──
export const oceanTheme = createTheme(vars, {
	color: {
		bg: "oklch(0.975 0.006 250)",
		surface: "oklch(0.99 0.003 250)",
		surfaceRaised: "oklch(0.95 0.01 250)",
		ink: "oklch(0.25 0.02 250)",
		inkMuted: "oklch(0.45 0.015 250)",
		inkFaint: "oklch(0.6 0.01 250)",
		border: "oklch(0.86 0.012 250)",
		borderStrong: "oklch(0.82 0.025 250)",
		accent: "oklch(0.55 0.18 255)",
		accentStrong: "oklch(0.45 0.2 255)",
		accentSoft: "oklch(0.93 0.03 255)",
		white: "oklch(1 0 0)",
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
		danger: "oklch(0.55 0.2 25)",
		dangerSubtle: "oklch(0.96 0.015 25)",
		success: "oklch(0.55 0.17 160)",
		successSubtle: "oklch(0.95 0.03 160)",
		warning: "oklch(0.6 0.16 85)",
		warningSubtle: "oklch(0.96 0.03 85)",
	},
	font: {
		display: 'Georgia, "Noto Serif SC", "Songti SC", "SimSun", serif',
		mono: "ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	},
});

// ── 主题注册表（/color 页面与初始化使用） ──
export const themes = {
	paper: { label: "暖纸 · 目录绿", theme: paperTheme, swatches: ["oklch(0.99 0.004 95)", "oklch(0.52 0.1 165)"] },
	midnight: { label: "暗夜 · 墨绿", theme: midnightTheme, swatches: ["oklch(0.21 0.014 260)", "oklch(0.68 0.12 165)"] },
	ocean: { label: "冷蓝 · 晴空", theme: oceanTheme, swatches: ["oklch(0.99 0.003 250)", "oklch(0.55 0.18 255)"] },
} as const;

export type ThemeName = keyof typeof themes;

// ── 布局常量（编译时值，不随主题） ──
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

// 页面底色随主题（组件 .page 已用 vars.color.bg，这里兜底 body）
globalStyle("body", {
	background: vars.color.bg,
	color: vars.color.ink,
	transition: "background-color 0.25s ease, color 0.25s ease",
});
