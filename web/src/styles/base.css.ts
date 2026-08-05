/**
 * base.css.ts — 通用组件样式（vanilla-extract）
 *
 * 单一来源：v2 三个页面 module.css 里重复定义的按钮体系收敛于此。
 * 组件用 `import { btnPrimary, btnGhost } from "../../styles/base.css.ts"` 复用。
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

// ── 按钮基础（数组组合的第一项） ──
export const btnBase = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	background: "transparent",
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.md,
	padding: `${space.xs} 14px`,
	cursor: "pointer",
	transition: "background 0.15s, color 0.15s, border-color 0.15s",
});

// 窄屏（≤600px）紧凑按钮：32px 高，紧凑内边距
const compactBtn = {
	paddingLeft: 10,
	paddingRight: 10,
	paddingTop: 0,
	paddingBottom: 0,
	fontSize: 12,
	lineHeight: 1,
	height: 32,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	boxSizing: "border-box",
} as const;

// ── 实心主按钮 ──
export const btnPrimary = style([
	btnBase,
	{
		color: vars.v2.white,
		background: vars.v2.accent,
		border: "none",
		fontWeight: 500,
		selectors: {
			"&:hover": { background: vars.v2.accentStrong },
			"&:disabled": { opacity: 0.5, cursor: "default" },
		},
		"@media": { "(max-width: 600px)": compactBtn },
	},
]);

// ── 幽灵按钮（描边） ──
export const btnGhost = style([
	btnBase,
	{
		selectors: {
			"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
			"&:disabled": { opacity: 0.35, cursor: "default" },
		},
		"@media": { "(max-width: 600px)": compactBtn },
	},
]);

// ── 导航/翻页大按钮（◀ ▶） ──
export const btnNav = style([
	btnBase,
	{
		fontSize: textSize.lg,
		lineHeight: 1,
		padding: `${space.xs} 12px`,
		selectors: {
			"&:hover:not(:disabled)": {
				background: vars.v2.surfaceRaised,
				color: vars.v2.ink,
			},
			"&:disabled": { opacity: 0.35, cursor: "default" },
		},
		"@media": {
			"(max-width: 600px)": { ...compactBtn, fontSize: 16, paddingLeft: 11, paddingRight: 11 },
		},
	},
]);

// ── 链接式返回按钮 ──
export const btnBack = style([
	btnBase,
	{
		borderColor: vars.v2.border,
		textDecoration: "none",
		display: "inline-block",
		whiteSpace: "nowrap",
		selectors: {
			"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
		},
	},
]);
