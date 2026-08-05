/**
 * AngleEditor — 角度编辑器（vanilla-extract 迁移）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../styles/tokens.css.ts";

export const fieldset = style({
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: `${space.md} 16px`,
	margin: `0 0 ${space.lg} 0`,
	background: vars.v2.surface,
});

globalStyle(`${fieldset} legend`, {
	fontWeight: 600,
	color: vars.v2.ink,
	padding: `0 ${space.xs}`,
});

export const legend = style({});

export const segmented = style({
	display: "inline-flex",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	overflow: "hidden",
	marginBottom: 10,
});

export const segBtn = style({
	padding: `${space.xs} 14px`,
	fontSize: textSize.sm,
	border: "none",
	cursor: "pointer",
	transition: "background 0.15s",
	background: "transparent",
	color: vars.v2.inkMuted,
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised },
		"& + &": { borderLeft: `1px solid ${vars.v2.border}` },
	},
});

export const segActive = style({
	padding: `${space.xs} 14px`,
	fontSize: textSize.sm,
	border: "none",
	cursor: "pointer",
	transition: "background 0.15s",
	background: vars.v2.accent,
	color: vars.v2.white,
	fontWeight: 600,
});

// 分段按钮相邻时消除重叠边框
globalStyle(`.${segActive} + .${segBtn}, .${segBtn} + .${segActive}`, {
	borderLeftColor: "transparent",
});

export const inputRow = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
});

export const input = style({
	width: 110,
	padding: `${space.xs} 8px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	background: vars.v2.bg,
	color: vars.v2.ink,
	fontSize: textSize.base,
	textAlign: "right",
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const unit = style({
	color: vars.v2.inkMuted,
	fontSize: textSize.sm,
	minWidth: 24,
});
