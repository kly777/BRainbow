/**
 * BookmarkPage — 网页书签（v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

export const page = style({
	maxWidth: 900,
	margin: "0 auto",
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
	gap: space.sm,
});

export const item = style({
	display: "flex",
	alignItems: "flex-start",
	gap: space.md,
	padding: space.md,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: vars.color.surface,
	transition: "border-color 0.15s, box-shadow 0.15s",
	selectors: {
		"&:hover": {
			borderColor: vars.color.accent,
			boxShadow: `0 2px 8px ${vars.color.accentSoft}`,
		},
	},
});

export const favicon = style({
	flexShrink: 0,
	width: 40,
	height: 40,
	borderRadius: radius.sm,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: "1.1rem",
	fontWeight: 600,
	background: vars.color.accentSoft,
	color: vars.color.accent,
});

export const itemBody = style({
	flex: 1,
	minWidth: 0,
});

export const itemTitle = style({
	fontSize: "1.05rem",
	fontWeight: 600,
	color: vars.color.accent,
	textDecoration: "none",
	display: "block",
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const itemUrl = style({
	fontSize: "0.85rem",
	color: vars.color.inkMuted,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	marginTop: 2,
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
	flexShrink: 0,
	display: "flex",
	gap: space.xs,
});

export const itemTags = style({
	display: "flex",
	flexWrap: "wrap",
	gap: 6,
	marginTop: 8,
});

export const itemTag = style({
	border: "none",
	background: "transparent",
	padding: 0,
	fontSize: "0.8rem",
	color: vars.color.accent,
	cursor: "pointer",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
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
