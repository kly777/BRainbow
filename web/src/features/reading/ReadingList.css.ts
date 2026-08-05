/**
 * ReadingList — 阅读列表（vanilla-extract 迁移，v2 令牌）
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

export const unknownLink = style({
	fontSize: "0.9rem",
	color: vars.v2.accent,
	textDecoration: "none",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const uploadBtn = style({
	padding: "8px 16px",
	background: vars.v2.accent,
	color: vars.v2.white,
	border: "none",
	borderRadius: 6,
	cursor: "pointer",
	fontSize: "0.9rem",
	fontWeight: 600,
	selectors: {
		"&:hover": { opacity: 0.9 },
	},
});

export const overlay = style({
	position: "fixed",
	inset: 0,
	background: "oklch(0 0 0 / 0.4)",
	zIndex: 100,
});

export const modal = style({
	position: "fixed",
	top: "50%",
	left: "50%",
	transform: "translate(-50%, -50%)",
	background: vars.v2.surface,
	padding: 24,
	borderRadius: 12,
	zIndex: 101,
	width: "90%",
	maxWidth: 600,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.15)",
	border: `1px solid ${vars.v2.border}`,
});

globalStyle(`${modal} h2`, {
	margin: "0 0 16px",
	fontSize: "1.2rem",
});

export const input = style({
	width: "100%",
	padding: "8px 12px",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 6,
	fontSize: "1rem",
	marginBottom: 12,
	background: vars.v2.surface,
	color: vars.v2.ink,
});

export const textarea = style({
	width: "100%",
	padding: "8px 12px",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 6,
	fontSize: "0.95rem",
	resize: "vertical",
	background: vars.v2.surface,
	color: vars.v2.ink,
});

export const modalActions = style({
	display: "flex",
	gap: 8,
	justifyContent: "flex-end",
	marginTop: 16,
});

export const cancelBtn = style({
	padding: "8px 16px",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 6,
	background: vars.v2.surface,
	cursor: "pointer",
});

export const submitBtn = style({
	padding: "8px 16px",
	background: vars.v2.accent,
	color: vars.v2.white,
	border: "none",
	borderRadius: 6,
	cursor: "pointer",
	fontWeight: 600,
	selectors: {
		"&:disabled": { opacity: 0.5, cursor: "not-allowed" },
	},
});

export const list = style({
	display: "flex",
	flexDirection: "column",
	gap: 12,
});

export const card = style({
	display: "block",
	padding: 16,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 8,
	background: vars.v2.surface,
	textDecoration: "none",
	color: "inherit",
	transition: "border-color 0.15s, box-shadow 0.15s",
	selectors: {
		"&:hover": {
			borderColor: vars.v2.accent,
			boxShadow: `0 2px 8px ${vars.v2.accentSoft}`,
		},
	},
});

export const cardTitle = style({
	fontSize: "1.05rem",
	fontWeight: 600,
	marginBottom: 6,
});

export const cardMeta = style({
	display: "flex",
	gap: 16,
	fontSize: "0.85rem",
	color: vars.v2.inkMuted,
});

export const ratio = style({
	selectors: {
		'&[data-known="high"]': { color: "oklch(0.5 0.18 150)" },
		'&[data-known="mid"]': { color: "oklch(0.55 0.16 80)" },
		'&[data-known="low"]': { color: "oklch(0.45 0.22 30)" },
	},
});

export const unknownCount = style({
	color: vars.v2.inkMuted,
});

export const barOuter = style({
	marginTop: 8,
	height: 4,
	background: vars.v2.bg,
	borderRadius: 2,
	overflow: "hidden",
});

export const barInner = style({
	height: "100%",
	background: vars.v2.accent,
	borderRadius: 2,
	transition: "width 0.3s",
});

export const empty = style({
	textAlign: "center",
	color: vars.v2.inkMuted,
	padding: "40px 0",
});
