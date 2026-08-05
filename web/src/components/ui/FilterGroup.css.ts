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
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.surface,
	color: vars.v2.inkMuted,
	cursor: "pointer",
	fontFamily: "inherit",
	whiteSpace: "nowrap",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised },
	},
});

export const active = style({
	background: vars.v2.accent,
	color: vars.v2.bg,
	borderColor: vars.v2.accent,
});
