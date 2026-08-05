/**
 * ConvSearch — 对话搜索（vanilla-extract 迁移，v2 令牌）
 */
import { keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

const fadeIn = keyframes({
	from: { opacity: 0, transform: "translateY(6px)" },
	to: { opacity: 1, transform: "translateY(0)" },
});

export const page = style({
	maxWidth: 800,
	margin: "0 auto",
	padding: 0,
	animation: `${fadeIn} 0.2s ease-out`,
});

export const topBar = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	padding: `${space.lg} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
});

export const backLink = style({
	fontSize: textSize.sm,
	color: vars.v2.accent,
	textDecoration: "none",
	fontWeight: 500,
	whiteSpace: "nowrap",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const title = style({
	fontSize: textSize.lg,
	color: vars.v2.ink,
	margin: 0,
});

export const searchBar = style({
	display: "flex",
	gap: space.sm,
	padding: `${space.lg} 20px`,
});

export const initialHint = style({
	padding: `0 20px ${space.md}`,
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	textAlign: "center",
});

export const tabs = style({
	display: "flex",
	gap: 2,
	padding: "0 20px",
	marginBottom: space.md,
});

export const tab = style({
	padding: "6px 16px",
	fontSize: textSize.sm,
	border: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
	color: vars.v2.inkMuted,
	cursor: "pointer",
	borderRadius: `${radius.md} ${radius.md} 0 0`,
	borderBottom: "none",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});

export const tabActive = style({
	padding: "6px 16px",
	fontSize: textSize.sm,
	border: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
	color: vars.v2.ink,
	cursor: "pointer",
	borderRadius: `${radius.md} ${radius.md} 0 0`,
	borderBottom: "none",
	fontWeight: 600,
});

export const inputWrap = style({
	flex: 1,
	position: "relative",
	display: "flex",
	alignItems: "center",
});

export const input = style({
	flex: 1,
	padding: "10px 36px 10px 14px",
	fontSize: textSize.base,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.bg,
	color: vars.v2.ink,
	outline: "none",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent },
	},
});

export const clearBtn = style({
	position: "absolute",
	right: 8,
	width: 22,
	height: 22,
	border: "none",
	borderRadius: "50%",
	background: vars.v2.inkFaint,
	color: vars.v2.bg,
	fontSize: 14,
	lineHeight: 1,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 0,
	opacity: 0.7,
	transition: "opacity 0.15s",
	selectors: {
		"&:hover": { opacity: 1 },
	},
});

export const btn = style({
	padding: "10px 24px",
	fontSize: textSize.base,
	border: "none",
	borderRadius: radius.md,
	background: vars.v2.accent,
	color: vars.v2.white,
	cursor: "pointer",
	fontWeight: 500,
	selectors: {
		"&:hover": { opacity: 0.9 },
	},
});

export const summary = style({
	padding: `0 20px ${space.md}`,
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
});

export const results = style({
	padding: `0 20px ${space.xl}`,
	display: "flex",
	flexDirection: "column",
	gap: space.md,
});

export const spinnerWrap = style({
	display: "flex",
	justifyContent: "center",
	padding: space.xl,
});

const spin = keyframes({
	to: { transform: "rotate(360deg)" },
});

export const spinner = style({
	width: 24,
	height: 24,
	border: `3px solid ${vars.v2.border}`,
	borderTopColor: vars.v2.accent,
	borderRadius: "50%",
	animation: `${spin} 0.7s linear infinite`,
});

export const item = style({
	padding: space.md,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.surface,
	cursor: "pointer",
	transition: "box-shadow 0.15s",
	textDecoration: "none",
	display: "block",
	color: "inherit",
	selectors: {
		"&:hover": { boxShadow: "0 2px 8px oklch(0 0 0 / 0.08)" },
	},
});

export const itemTop = style({
	display: "flex",
	gap: space.sm,
	marginBottom: 6,
});

export const badge = style({
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: radius.sm,
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
	fontWeight: 500,
});

export const tagType = style({
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: radius.sm,
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
});

export const itemTitle = style({
	fontSize: textSize.base,
	fontWeight: 600,
	color: vars.v2.ink,
	marginBottom: 4,
	lineHeight: 1.4,
});

export const itemSnippet = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	lineHeight: 1.5,
	display: "-webkit-box",
	WebkitLineClamp: 3,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
});

export const itemMeta = style({
	fontSize: textSize.xs,
	color: vars.v2.inkMuted,
	marginTop: 6,
});

export const empty = style({
	textAlign: "center",
	padding: space.xl,
	color: vars.v2.inkMuted,
	fontSize: textSize.base,
});
