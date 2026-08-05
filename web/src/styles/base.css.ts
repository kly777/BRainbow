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
	color: vars.color.inkMuted,
	background: "transparent",
	border: `1px solid ${vars.color.borderStrong}`,
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
		color: vars.color.white,
		background: vars.color.accent,
		border: "none",
		fontWeight: 500,
		selectors: {
			"&:hover": { background: vars.color.accentStrong },
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
			"&:hover": { background: vars.color.surfaceRaised, color: vars.color.ink },
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
				background: vars.color.surfaceRaised,
				color: vars.color.ink,
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
		borderColor: vars.color.border,
		textDecoration: "none",
		display: "inline-block",
		whiteSpace: "nowrap",
		selectors: {
			"&:hover": { background: vars.color.surfaceRaised, color: vars.color.ink },
		},
	},
]);

// ── 底部胶囊条（fixed 贴底，桌面居中胶囊 / 移动全宽） ──
// actionRow（显示答案前）与 ratings（显示答案后）共用，保证高度一致
export const bottomBar = style({
	position: "fixed",
	bottom: 0,
	left: 0,
	right: 0,
	marginInline: "auto",
	width: "fit-content",
	minHeight: 48,
	zIndex: 20,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.sm,
	padding: "0 16px", // 水平内边距（高度由 minHeight 决定）
	background: vars.color.surface,
	border: `1px solid ${vars.color.borderStrong}`,
	borderBottom: "none",
	borderRadius: "14px 14px 0 0",
	boxShadow: "0 -4px 16px rgb(0 0 0 / 8%)",
	flexWrap: "nowrap",
	maxWidth: "100vw",
	"@media": {
		"(max-width: 600px)": {
			width: "100%",
			gap: 4,
			padding: "0 12px",
			borderRadius: 0,
			borderLeft: "none",
			borderRight: "none",
		},
	},
});
