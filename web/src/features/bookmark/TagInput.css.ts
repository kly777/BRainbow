/**
 * 书签标签输入（v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, vars } from "@styles/tokens.css.ts";

export const tagInput = style({});

export const tags = style({
	display: "flex",
	flexWrap: "wrap",
	gap: 6,
	marginBottom: 8,
});

export const tag = style({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	padding: "2px 8px",
	background: vars.color.accentSoft,
	color: vars.color.accent,
	borderRadius: "999px",
	fontSize: "0.85rem",
});

export const tagRemove = style({
	border: "none",
	background: "transparent",
	color: "inherit",
	cursor: "pointer",
	fontSize: "0.9rem",
	lineHeight: 1,
	padding: 0,
	selectors: {
		"&:hover": { opacity: 0.7 },
	},
});

export const inputRow = style({});

export const input = style({
	width: "100%",
	padding: "6px 12px",
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	fontSize: "0.9rem",
	background: vars.color.surface,
	color: vars.color.ink,
});

export const dropdown = style({
	position: "absolute",
	zIndex: 20,
	marginTop: 4,
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	boxShadow: "0 4px 16px oklch(0 0 0 / 0.12)",
	maxHeight: 200,
	overflowY: "auto",
});

export const dropdownDelete = style({
	flexShrink: 0,
	width: 18,
	height: 18,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	border: "none",
	background: "transparent",
	color: vars.color.danger,
	fontSize: "0.9rem",
	lineHeight: 1,
	padding: 0,
	cursor: "pointer",
	opacity: 0,
	transition: "opacity 0.12s",
	selectors: {
		"&:hover": { background: vars.color.dangerSubtle, borderRadius: "50%" },
	},
});

export const dropdownItem = style({
	display: "flex",
	alignItems: "center",
	gap: 4,
	width: "100%",
	padding: "4px 6px 4px 12px",
	border: "none",
	background: "transparent",
	selectors: {
		"&:hover": {
			background: vars.color.accentSoft,
			// hover 时显示删除按钮
			[`& ${dropdownDelete}`]: { opacity: 1 },
		},
	},
});

export const dropdownSelect = style({
	flex: 1,
	minWidth: 0,
	display: "flex",
	alignItems: "center",
	gap: 8,
	padding: "2px 0",
	border: "none",
	background: "transparent",
	color: vars.color.ink,
	fontSize: "0.9rem",
	textAlign: "left",
	cursor: "pointer",
});

export const dropdownName = style({
	flex: 1,
	minWidth: 0,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

export const dropdownCount = style({
	fontSize: "0.75rem",
	color: vars.color.inkMuted,
	flexShrink: 0,
});

export const createNew = style({
	color: vars.color.accent,
	fontWeight: 600,
});

globalStyle(`${tagInput}`, {
	position: "relative",
});
