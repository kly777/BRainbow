/**
 * Toast — 通知（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const container = style({
	position: "fixed",
	bottom: 20,
	right: 20,
	zIndex: 9999,
	display: "flex",
	flexDirection: "column-reverse",
	gap: space.sm,
	maxWidth: 420,
	width: "100%",
	pointerEvents: "none",
});

const slideIn = keyframes({
	from: { opacity: 0, transform: "translateX(100%) scale(0.95)" },
	to: { opacity: 1, transform: "translateX(0) scale(1)" },
});

const slideOut = keyframes({
	from: { opacity: 1, transform: "translateX(0) scale(1)" },
	to: { opacity: 0, transform: "translateX(100%) scale(0.95)" },
});

const shrink = keyframes({
	from: { width: "100%" },
	to: { width: "0%" },
});

export const toast = style({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	padding: `${space.md} 16px`,
	borderRadius: radius.md,
	boxShadow: "0 4px 12px oklch(0 0 0 / 0.12)",
	fontSize: textSize.base,
	lineHeight: 1.5,
	pointerEvents: "auto",
	position: "relative",
	overflow: "hidden",
	backdropFilter: "blur(8px)",
	animation: `${slideIn} 0.3s ease-out`,
});

export const leaving = style({
	animation: `${slideOut} 0.25s ease-in forwards`,
});

export const body = style({
	display: "flex",
	alignItems: "flex-start",
	gap: space.sm,
	flex: 1,
	minWidth: 0,
});

export const icon = style({
	flexShrink: 0,
	width: 20,
	height: 20,
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: textSize.sm,
	fontWeight: 700,
	marginTop: 1,
});

export const content = style({
	flex: 1,
	minWidth: 0,
});

export const title = style({
	fontWeight: 600,
	fontSize: textSize.base,
	wordBreak: "break-word",
});

export const code = style({
	display: "inline-block",
	marginLeft: 6,
	padding: space.xs,
	borderRadius: radius.sm,
	fontSize: textSize.xs,
	fontFamily:
		'ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
	fontWeight: 500,
	verticalAlign: "middle",
	opacity: 0.85,
});

export const message = style({
	marginTop: 4,
	fontSize: textSize.sm,
	opacity: 0.9,
	wordBreak: "break-word",
});

export const close = style({
	flexShrink: 0,
	background: "none",
	border: "none",
	cursor: "pointer",
	padding: `0 0 0 ${radius.md}`,
	fontSize: textSize.lg,
	lineHeight: 1,
	opacity: 0.55,
	transition: "opacity 0.15s",
	color: "inherit",
	marginTop: 1,
	selectors: {
		"&:hover": { opacity: 1 },
	},
});

export const progress = style({
	position: "absolute",
	bottom: 0,
	left: 0,
	height: 3,
	background: "currentColor",
	opacity: 0.25,
	borderRadius: `0 0 0 ${radius.md}`,
	animation: `${shrink} linear forwards`,
});

// ── 类型色 ──
export const error = style({
	background: vars.color.dangerSubtle,
	border: "1px solid oklch(0.85 0.06 25)",
	color: "oklch(0.3 0.09 25)",
});

export const warning = style({
	background: vars.color.warningSubtle,
	border: "1px solid oklch(0.88 0.09 85)",
	color: "oklch(0.35 0.08 60)",
});

export const success = style({
	background: vars.color.successSubtle,
	border: "1px solid oklch(0.85 0.08 160)",
	color: "oklch(0.3 0.08 160)",
});

export const info = style({
	background: vars.color.accentSoft,
	border: "1px solid oklch(0.85 0.08 165)",
	color: "oklch(0.3 0.07 165)",
});

// 类型内 icon/code 色
globalStyle(`.${error} .icon`, {
	background: vars.color.danger,
	color: vars.color.white,
});
globalStyle(`.${error} .code`, {
	background: "oklch(0.55 0.2 25 / 0.12)",
});
globalStyle(`.${warning} .icon`, {
	background: vars.color.warning,
	color: vars.color.white,
});
globalStyle(`.${warning} .code`, {
	background: "oklch(0.6 0.16 85 / 0.12)",
});
globalStyle(`.${success} .icon`, {
	background: vars.color.success,
	color: vars.color.white,
});
globalStyle(`.${success} .code`, {
	background: "oklch(0.55 0.17 160 / 0.12)",
});
globalStyle(`.${info} .icon`, {
	background: vars.color.accent,
	color: vars.color.white,
});
globalStyle(`.${info} .code`, {
	background: "oklch(0.52 0.1 165 / 0.12)",
});

// 变体映射
export const variants: Record<string, string> = { error, warning, success, info };
