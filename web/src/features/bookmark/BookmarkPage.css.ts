/**
 * BookmarkPage — 网页书签（v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

export const page = style({
	padding: space.lg,
});

export const header = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	marginBottom: space.lg,
});

globalStyle(`${header} h1`, {
	fontSize: "1.5rem",
	margin: 0,
	flex: 1,
});

export const state = style({
	textAlign: "center",
	color: vars.color.inkMuted,
	padding: "40px 0",
});

export const errorText = style({
	color: vars.color.danger,
	marginBottom: space.md,
});

export const list = style({
	display: "flex",
	flexDirection: "column",
	gap: 2,
});

export const item = style({
	position: "relative",
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: "4px 8px",
	borderRadius: radius.sm,
	minWidth: 0,
	transition: "background 0.12s",
	selectors: {
		"&:hover": {
			background: vars.color.bg,
		},
	},
});

export const itemTitle = style({
	fontSize: "0.85rem",
	fontWeight: 500,
	color: vars.color.ink,
	textDecoration: "none",
	flex: "1 1 auto",
	minWidth: 0,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	selectors: {
		"&:hover": {
			color: vars.color.accent,
			textDecoration: "underline",
		},
	},
});

export const itemUrl = style({
	fontSize: "0.72rem",
	color: vars.color.inkMuted,
	flex: "0 1 auto",
	maxWidth: "30%",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
});

export const itemDesc = style({
	fontSize: "0.9rem",
	color: vars.color.ink,
	marginTop: 6,
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
});

export const itemActions = style({
	display: "flex",
	alignItems: "center",
	gap: 2,
	flexShrink: 0,
});

export const itemTags = style({
	flex: "0 0 auto",
	maxWidth: "30%",
	display: "flex",
	gap: 4,
	overflow: "hidden",
	whiteSpace: "nowrap",
});

export const itemTag = style({
	border: "none",
	background: vars.color.accentSoft,
	padding: "0 6px",
	borderRadius: "999px",
	fontSize: "0.7rem",
	lineHeight: "18px",
	color: vars.color.accent,
	cursor: "pointer",
	flexShrink: 0,
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

// 删除按钮用红色图标
globalStyle(`${itemActions} button:last-child`, {
	color: vars.color.danger,
});

export const filterBar = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	marginBottom: space.md,
	padding: "6px 12px",
	background: vars.color.accentSoft,
	borderRadius: radius.md,
});

export const filterLabel = style({
	fontSize: "0.9rem",
	color: vars.color.accent,
	fontWeight: 600,
});

export const pagination = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	marginTop: space.lg,
	fontSize: "0.85rem",
	color: vars.color.inkMuted,
});

export const paginationActions = style({
	display: "flex",
	gap: space.xs,
});

export const formError = style({
	background: vars.color.dangerSubtle,
	color: vars.color.danger,
	padding: "8px 12px",
	borderRadius: radius.sm,
	marginBottom: space.md,
	fontSize: "0.9rem",
});

export const formGroup = style({
	marginBottom: space.md,
});

export const formLabel = style({
	display: "block",
	fontSize: "0.85rem",
	color: vars.color.inkMuted,
	marginBottom: 4,
});

export const formInput = style({
	width: "100%",
	padding: "8px 12px",
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	fontSize: "1rem",
	background: vars.color.surface,
	color: vars.color.ink,
});

export const formTextarea = style({
	width: "100%",
	padding: "8px 12px",
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	fontSize: "0.95rem",
	resize: "vertical",
	background: vars.color.surface,
	color: vars.color.ink,
});
