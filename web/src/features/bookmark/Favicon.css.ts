/**
 * 书签 favicon（v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, vars } from "@styles/tokens.css.ts";

export const img = style({
	width: 20,
	height: 20,
	borderRadius: radius.sm,
	objectFit: "contain",
	flexShrink: 0,
});

export const letter = style({
	width: 20,
	height: 20,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	fontSize: "0.8rem",
	fontWeight: 600,
	borderRadius: radius.sm,
	background: vars.color.accentSoft,
	color: vars.color.accent,
});
