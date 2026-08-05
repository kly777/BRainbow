/**
 * Toolbar — 工具栏（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const toolbar = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	padding: `${space.sm} 16px`,
	background: vars.color.surfaceRaised,
	borderBottom: `1px solid ${vars.color.border}`,
	flexShrink: 0,
});

export const title = style({
	fontSize: textSize.base,
	fontWeight: 500,
	color: vars.color.inkMuted,
});

export const actions = style({
	marginLeft: "auto",
	display: "flex",
	gap: space.sm,
});

export const backBtn = style({
	padding: `${space.xs} 10px`,
	fontSize: textSize.sm,
	background: vars.color.bg,
	color: vars.color.inkMuted,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontFamily: "inherit",
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});
