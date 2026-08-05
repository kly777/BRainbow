/**
 * AngleEditor — 角度编辑器（vanilla-extract 迁移）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const fieldset = style({
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	padding: `${space.md} 16px`,
	margin: `0 0 ${space.lg} 0`,
	background: vars.color.surface,
});

globalStyle(`${fieldset} legend`, {
	fontWeight: 600,
	color: vars.color.ink,
	padding: `0 ${space.xs}`,
});

export const legend = style({});

export const segmented = style({
	display: "inline-flex",
	border: `1px solid ${vars.color.border}`,
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
	color: vars.color.inkMuted,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
		"& + &": { borderLeft: `1px solid ${vars.color.border}` },
	},
});

export const segActive = style({
	padding: `${space.xs} 14px`,
	fontSize: textSize.sm,
	border: "none",
	cursor: "pointer",
	transition: "background 0.15s",
	background: vars.color.accent,
	color: vars.color.white,
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
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	background: vars.color.bg,
	color: vars.color.ink,
	fontSize: textSize.base,
	textAlign: "right",
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
		},
	},
});

export const unit = style({
	color: vars.color.inkMuted,
	fontSize: textSize.sm,
	minWidth: 24,
});
