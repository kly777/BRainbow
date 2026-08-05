/**
 * Breadcrumb — 面包屑（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { space, textSize, vars } from "@styles/tokens.css.ts";

export const breadcrumb = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
	padding: `${space.md} 0`,
	flexWrap: "wrap",
});

export const link = style({
	fontSize: textSize.base,
	color: vars.color.accent,
	textDecoration: "none",
	fontWeight: 500,
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const current = style({
	fontSize: textSize.base,
	color: vars.color.inkMuted,
	fontWeight: 400,
});

export const sep = style({
	fontSize: textSize.lg,
	color: vars.color.inkFaint,
	userSelect: "none",
});
