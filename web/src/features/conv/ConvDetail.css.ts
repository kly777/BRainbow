/**
 * ConvDetail — 对话详情（vanilla-extract 迁移，v2 令牌）
 */
import { keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

const fadeIn = keyframes({
	from: { opacity: 0, transform: "translateY(6px)" },
	to: { opacity: 1, transform: "translateY(0)" },
});

export const page = style({
	maxWidth: 900,
	margin: "0 auto",
	padding: 0,
	animation: `${fadeIn} 0.2s ease-out`,
});

export const loading = style({
	padding: space.xl,
	textAlign: "center",
	color: vars.v2.inkMuted,
});

export const topBar = style({
	padding: `${space.lg} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	display: "flex",
	alignItems: "flex-start",
	gap: space.md,
});

export const backLink = style({
	fontSize: textSize.sm,
	color: vars.v2.accent,
	textDecoration: "none",
	fontWeight: 500,
	whiteSpace: "nowrap",
	marginTop: 4,
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const titleArea = style({
	flex: 1,
});

export const title = style({
	fontSize: textSize.lg,
	color: vars.v2.ink,
	margin: "0 0 6px 0",
	lineHeight: 1.3,
});

export const tag = style({
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: radius.sm,
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
	marginRight: space.sm,
});

export const date = style({
	fontSize: textSize.xs,
	color: vars.v2.inkMuted,
});

export const body = style({
	padding: `${space.lg} 20px ${space.xl}`,
});

export const sectionTitle = style({
	fontSize: textSize.base,
	color: vars.v2.ink,
	margin: `0 0 ${space.md} 0`,
	paddingBottom: space.sm,
	borderBottom: `1px solid ${vars.v2.border}`,
});

export const qaSection = style({
	marginBottom: space.xl,
});

export const qaBlock = style({
	marginBottom: space.lg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	overflow: "hidden",
});

export const question = style({
	padding: space.md,
	background: vars.v2.bg,
	display: "flex",
	gap: space.sm,
	borderBottom: `1px solid ${vars.v2.border}`,
});

export const qLabel = style({
	fontSize: textSize.xs,
	fontWeight: 700,
	color: vars.v2.accent,
	background: vars.v2.accentSoft,
	width: 20,
	height: 20,
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	marginTop: 2,
});

export const answer = style({
	padding: space.md,
	display: "flex",
	gap: space.sm,
	background: vars.v2.surface,
});

export const aLabel = style({
	fontSize: textSize.xs,
	fontWeight: 700,
	color: vars.v2.success,
	background: vars.v2.successSubtle,
	width: 20,
	height: 20,
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	marginTop: 2,
});

export const md = style({
	flex: 1,
	fontSize: textSize.base,
	lineHeight: 1.7,
	color: vars.v2.ink,
	overflowX: "auto",
});

export const articleSection = style({
	marginBottom: space.xl,
});

export const articleBlock = style({
	marginBottom: space.md,
	padding: space.md,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.surface,
});

export const articleTitle = style({
	fontSize: textSize.base,
	color: vars.v2.ink,
	margin: `0 0 ${space.sm} 0`,
	display: "flex",
	alignItems: "center",
	gap: space.sm,
});

export const artTag = style({
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: radius.sm,
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
});
