/**
 * FilterGroup — 筛选按钮组（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const group = style({
	display: "flex",
	gap: space.xs,
});

export const btn = style({
	padding: `${space.xs} ${space.sm}`,
	fontSize: textSize.xs,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: vars.color.surface,
	color: vars.color.inkMuted,
	cursor: "pointer",
	fontFamily: "inherit",
	whiteSpace: "nowrap",
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});

export const active = style({
	background: vars.color.accent,
	color: vars.color.bg,
	borderColor: vars.color.accent,
});
