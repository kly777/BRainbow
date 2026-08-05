/**
 * ReadingUnknown — 生词表（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { space, vars } from "@styles/tokens.css.ts";

export const page = style({
	maxWidth: 700,
	margin: "0 auto",
	padding: space.lg,
});

export const back = style({
	fontSize: "0.9rem",
	color: vars.color.accent,
	textDecoration: "none",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

globalStyle(`${page} h1`, {
	margin: "12px 0 4px",
	fontSize: "1.4rem",
});

export const subtitle = style({
	fontSize: "0.85rem",
	color: vars.color.inkMuted,
	margin: "0 0 24px",
});

export const list = style({
	display: "flex",
	flexDirection: "column",
	gap: 8,
});

export const card = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: "12px 16px",
	border: `1px solid ${vars.color.border}`,
	borderRadius: 8,
	background: vars.color.surface,
});

export const wordMain = style({
	display: "flex",
	flexDirection: "column",
	gap: 2,
});

export const word = style({
	fontSize: "1.05rem",
	fontWeight: 600,
});

export const counts = style({
	fontSize: "0.8rem",
	color: vars.color.inkMuted,
});

export const knownBtn = style({
	padding: "4px 12px",
	border: "1px solid oklch(0.5 0.18 150)",
	borderRadius: 6,
	background: "transparent",
	color: "oklch(0.5 0.18 150)",
	cursor: "pointer",
	fontSize: "0.85rem",
	fontWeight: 600,
	selectors: {
		"&:hover": {
			background: "oklch(0.5 0.18 150)",
			color: vars.color.white,
		},
	},
});

export const empty = style({
	textAlign: "center",
	color: vars.color.inkMuted,
	padding: "40px 0",
});
