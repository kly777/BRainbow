/**
 * ColorEditor — 颜色编辑器（vanilla-extract 迁移，v2 令牌）
 */
import { composeStyles, globalStyle, style } from "@vanilla-extract/css";
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

export const list = style({
	display: "flex",
	flexDirection: "column",
	gap: space.sm,
	marginBottom: space.md,
});

export const colorRow = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: `${space.xs} 8px`,
	background: vars.color.surfaceRaised,
	borderRadius: radius.md,
	flexWrap: "wrap",
});

export const swatch = style({
	width: 28,
	height: 28,
	borderRadius: radius.sm,
	border: `1px solid ${vars.color.border}`,
	flexShrink: 0,
});

export const segmented = style({
	display: "inline-flex",
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	overflow: "hidden",
	flexShrink: 0,
});

export const segBtn = style({
	padding: `${space.xs} 10px`,
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
	borderRadius: radius.md,
	padding: `${space.xs} 10px`,
	fontSize: textSize.sm,
	border: "none",
	cursor: "pointer",
	transition: "background 0.15s",
	background: vars.color.accent,
	color: vars.color.white,
	fontWeight: 600,
});

const hexBase = style({
	padding: `${space.xs} 6px`,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	background: vars.color.bg,
	color: vars.color.ink,
	fontFamily: "monospace",
	fontSize: textSize.sm,
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
		},
	},
});

export const hexInput = composeStyles(
	hexBase,
	style({ width: 68 }),
);

export const triple = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
});

export const rangeHint = style({
	fontSize: textSize.xs,
	color: vars.color.inkMuted,
	whiteSpace: "nowrap",
	marginLeft: 4,
	flexShrink: 0,
});

export const channel = composeStyles(
	hexBase,
	style({
		width: 58,
		textAlign: "right",
		selectors: {
			"&::-webkit-inner-spin-button": {
				WebkitAppearance: "none",
				margin: 0,
			},
			"&::-webkit-outer-spin-button": {
				WebkitAppearance: "none",
				margin: 0,
			},
		},
	}),
);

export const removeBtn = style({
	marginLeft: "auto",
	width: 26,
	height: 26,
	border: `1px solid ${vars.color.danger}`,
	borderRadius: radius.sm,
	background: vars.color.dangerSubtle,
	color: vars.color.danger,
	fontSize: textSize.base,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	selectors: {
		"&:disabled": { opacity: 0.35, cursor: "not-allowed" },
		"&:hover:not(:disabled)": { background: vars.color.dangerSubtle },
	},
});

export const addBtn = style({
	padding: `${space.xs} 14px`,
	border: `1px dashed ${vars.color.border}`,
	borderRadius: radius.md,
	background: "transparent",
	color: vars.color.inkMuted,
	fontSize: textSize.sm,
	cursor: "pointer",
	selectors: {
		"&:hover": {
			borderColor: vars.color.accent,
			color: vars.color.accent,
			background: vars.color.accentSoft,
		},
	},
});
