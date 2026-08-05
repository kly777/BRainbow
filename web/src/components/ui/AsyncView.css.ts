/**
 * AsyncView — 异步视图状态（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const state = style({
	padding: `${space.xl} 16px`,
	textAlign: "center",
	color: vars.color.inkMuted,
	fontSize: textSize.base,
});

export const errorText = style({
	color: vars.color.danger,
	marginBottom: 10,
});

export const retryBtn = style({
	padding: `${space.xs} 16px`,
	background: vars.color.accent,
	color: vars.color.white,
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	selectors: {
		"&:hover": { background: vars.color.accentStrong },
	},
});
