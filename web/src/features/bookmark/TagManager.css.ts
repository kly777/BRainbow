/**
 * 标签管理（v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

export const state = style({
	textAlign: "center",
	color: vars.color.inkMuted,
	padding: "24px 0",
	fontSize: "0.9rem",
});

export const list = style({
	display: "flex",
	flexDirection: "column",
	gap: 4,
	maxHeight: "50vh",
	overflowY: "auto",
});

export const row = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: "6px 10px",
	borderRadius: radius.sm,
	selectors: {
		"&:hover": { background: vars.color.bg },
	},
});

export const name = style({
	flex: 1,
	minWidth: 0,
	fontSize: "0.9rem",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

export const count = style({
	flexShrink: 0,
	fontSize: "0.8rem",
	color: vars.color.inkMuted,
});
