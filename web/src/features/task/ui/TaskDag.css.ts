/**
 * TaskDag — 依赖图（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../styles/tokens.css.ts";

export const dagContainer = style({
	background: vars.v2.surface,
	borderRadius: radius.lg,
	boxShadow: "0 1px 3px oklch(0 0 0 / 0.1)",
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
	height: "var(--cmp-height, 400px)",
});

export const dagToolbar = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: `${space.lg} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	flexShrink: 0,
	flexWrap: "wrap",
	gap: space.md,
});

export const dagTitle = style({
	margin: 0,
	fontSize: textSize.lg,
	color: vars.v2.ink,
	fontWeight: 600,
});

export const dagControls = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	flexWrap: "wrap",
});

export const taskSelect = style({
	padding: `${space.xs} 12px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	color: vars.v2.ink,
	background: vars.v2.surface,
	outline: "none",
	cursor: "pointer",
	maxWidth: 200,
	selectors: {
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const zoomBtn = style({
	padding: `${space.xs} 12px`,
	background: vars.v2.surfaceRaised,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.v2.ink,
	transition: "all 0.15s",
	minWidth: 36,
	textAlign: "center",
	selectors: {
		"&:hover": {
			background: vars.v2.border,
			borderColor: vars.v2.inkMuted,
		},
	},
});

export const canvasWrap = style({
	flex: 1,
	position: "relative",
	overflow: "hidden",
	minHeight: 0,
});

export const dagCanvas = style({
	width: "100%",
	height: "100%",
	display: "block",
});

export const emptyHint = style({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	color: vars.v2.inkMuted,
	padding: space.xl,
});

export const hintP = style({
	margin: `0 0 ${space.sm} 0`,
	fontSize: textSize.base,
});

export const hintSub = style({
	fontSize: textSize.sm,
	color: vars.v2.border,
});

globalStyle(`${emptyHint} p`, {
	margin: `0 0 ${space.sm} 0`,
	fontSize: textSize.base,
});
