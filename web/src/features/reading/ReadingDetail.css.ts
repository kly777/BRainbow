/**
 * ReadingDetail — 阅读详情（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, vars } from "../../styles/tokens.css.ts";

export const page = style({
	maxWidth: 1100,
	margin: "0 auto",
	padding: space.lg,
	display: "grid",
	gridTemplateColumns: "1fr 280px",
	gridTemplateRows: "auto auto 1fr",
	gap: space.md,
	"@media": {
		"(max-width: 768px)": { gridTemplateColumns: "1fr" },
	},
});

export const back = style({
	gridColumn: "1 / -1",
	fontSize: "0.9rem",
	color: vars.v2.accent,
	textDecoration: "none",
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const header = style({
	gridColumn: 1,
});

globalStyle(`${header} h1`, {
	margin: "0 0 4px",
	fontSize: "1.3rem",
});

export const meta = style({
	fontSize: "0.85rem",
	color: vars.v2.inkMuted,
	display: "flex",
	gap: 16,
});

export const recommendBanner = style({
	gridColumn: 1,
	display: "block",
	padding: "8px 16px",
	background: "oklch(0.95 0.05 250 / 0.5)",
	border: "1px solid oklch(0.85 0.08 250)",
	borderRadius: 8,
	fontSize: "0.9rem",
	color: vars.v2.accent,
	textDecoration: "none",
	selectors: {
		"&:hover": { background: "oklch(0.92 0.06 250 / 0.5)" },
	},
});

export const content = style({
	gridColumn: 1,
	gridRow: 3,
	fontSize: "1rem",
	lineHeight: 1.8,
	overflowY: "auto",
	maxHeight: "calc(100vh - 240px)",
	padding: space.md,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 8,
	background: vars.v2.surface,
});

export const paragraph = style({
	marginBottom: "1em",
});

export const word = style({
	cursor: "pointer",
	selectors: {
		"&:hover": {
			background: "oklch(0.92 0.03 200 / 0.25)",
			borderRadius: 2,
		},
	},
});

export const unknownWord = style({
	cursor: "pointer",
	textDecoration: "underline wavy oklch(0.45 0.22 30) 1.5px",
	textUnderlineOffset: 3,
	fontWeight: 600,
	selectors: {
		"&:hover": {
			background: "oklch(0.92 0.05 30 / 0.2)",
			borderRadius: 2,
		},
	},
});

export const sidebar = style({
	gridColumn: 2,
	gridRow: "2 / 4",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 8,
	padding: space.md,
	background: vars.v2.surface,
	display: "flex",
	flexDirection: "column",
	maxHeight: "calc(100vh - 120px)",
	"@media": {
		"(max-width: 768px)": {
			gridColumn: 1,
			gridRow: "auto",
			maxHeight: 400,
		},
	},
});

export const wordListArea = style({
	flex: 1,
	overflowY: "auto",
	minHeight: 0,
});

export const sidebarFooter = style({
	flexShrink: 0,
	paddingTop: 10,
	borderTop: `1px solid ${vars.v2.border}`,
	marginTop: 8,
});

globalStyle(`${sidebar} h3`, {
	margin: "0 0 8px",
	fontSize: "1rem",
});

export const uploadUnknownBtn = style({
	width: "100%",
	marginBottom: 10,
	padding: "6px 12px",
	border: "1px solid oklch(0.45 0.22 30)",
	borderRadius: 6,
	background: "transparent",
	color: "oklch(0.45 0.22 30)",
	fontSize: 12,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: "oklch(0.45 0.22 30)", color: vars.v2.white },
		"&:disabled": { opacity: 0.5, cursor: "not-allowed" },
	},
});

export const wordList = style({
	display: "flex",
	flexDirection: "column",
	gap: 4,
});

export const wordItem = style({
	display: "flex",
	alignItems: "center",
	gap: 6,
	padding: "4px 6px",
	borderRadius: 4,
	fontSize: "0.9rem",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});

export const wordName = style({
	flex: 1,
});

export const knownWord = style({
	color: vars.v2.inkMuted,
	textDecoration: "line-through",
});

export const ignoredWordSidebar = style({
	color: vars.v2.inkMuted,
	fontStyle: "italic",
});

export const knownIcon = style({
	color: "oklch(0.5 0.18 150)",
	fontSize: 12,
	cursor: "pointer",
});

export const unknownIcon = style({
	color: "oklch(0.45 0.22 30)",
	fontSize: 12,
	cursor: "pointer",
});

export const ignoredIcon = style({
	color: vars.v2.inkMuted,
	fontSize: 12,
	cursor: "pointer",
});

export const ignoreBtn = style({
	border: "none",
	background: "none",
	cursor: "pointer",
	padding: "2px 4px",
	fontSize: 11,
	color: vars.v2.inkMuted,
	opacity: 0,
	borderRadius: 3,
	selectors: {
		[`${wordItem}:hover &`]: { opacity: 1 },
		"&:hover": { background: vars.v2.bg, color: vars.v2.ink },
	},
});

export const notesSection = style({
	marginBottom: 4,
});

globalStyle(`${notesSection} h3`, {
	fontSize: "0.95rem",
	margin: "0 0 6px",
});

export const notesInput = style({
	width: "100%",
	boxSizing: "border-box",
	padding: 8,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 6,
	background: vars.v2.bg,
	color: vars.v2.ink,
	fontSize: "0.85rem",
	lineHeight: 1.5,
	resize: "vertical",
	fontFamily: "inherit",
	selectors: {
		"&:focus": { outline: "none", borderColor: vars.v2.accent },
	},
});

export const copyBtn = style({
	width: "100%",
	marginTop: 8,
	padding: "8px 12px",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 6,
	background: vars.v2.surface,
	color: vars.v2.ink,
	fontSize: "0.85rem",
	cursor: "pointer",
	transition: "background 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});
