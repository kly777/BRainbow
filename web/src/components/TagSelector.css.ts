/**
 * TagSelector — 标签选择器（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../styles/tokens.css.ts";

export const tagSelector = style({
	position: "relative",
});

export const tags = style({
	display: "flex",
	flexWrap: "wrap",
	gap: space.xs,
	marginBottom: space.xs,
});

export const tag = style({
	display: "inline-flex",
	alignItems: "center",
	gap: 2,
	padding: "2px 6px",
	fontSize: textSize.xs,
	borderRadius: radius.sm,
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
	whiteSpace: "nowrap",
});

export const tagRemove = style({
	marginLeft: 2,
	cursor: "pointer",
	fontSize: "0.85em",
	opacity: 0.6,
	background: "none",
	border: "none",
	padding: 0,
	color: "inherit",
	lineHeight: 1,
	selectors: {
		"&:hover": { opacity: 1 },
	},
});

export const inputRow = style({
	display: "flex",
	gap: space.xs,
});

export const input = style({
	flex: 1,
	padding: `${space.xs} ${space.sm}`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	background: vars.v2.surface,
	color: vars.v2.ink,
	outline: "none",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent },
	},
});

export const dropdown = style({
	position: "absolute",
	top: "100%",
	left: 0,
	right: 0,
	zIndex: 10,
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	boxShadow: "0 4px 12px oklch(0 0 0 / 0.1)",
	maxHeight: 200,
	overflowY: "auto",
});

export const dropdownItem = style({
	padding: `${space.xs} ${space.sm}`,
	fontSize: textSize.sm,
	cursor: "pointer",
	transition: "background 0.1s",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});

export const dropdownItemActive = style({
	background: vars.v2.accentSoft,
});

export const createNew = style({
	color: vars.v2.accent,
	fontWeight: 500,
});
