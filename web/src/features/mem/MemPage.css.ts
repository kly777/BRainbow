/**
 * MemPage — 页面布局（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const page = style({
	display: "flex",
	height: "100vh",
	background: vars.color.bg,
	color: vars.color.ink,
});

export const main = style({
	flex: 1,
	display: "flex",
	flexDirection: "column",
	minWidth: 0,
	overflowY: "auto",
});

export const topBar = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: space.md,
	padding: `${space.sm} 20px`,
	borderBottom: `1px solid ${vars.color.border}`,
	background: vars.color.surface,
	flexShrink: 0,
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const hamburger = style({
	display: "block",
	background: "none",
	border: "none",
	fontSize: textSize.lg,
	color: vars.color.inkFaint,
	cursor: "pointer",
	padding: `${space.xs} 8px`,
	marginRight: 4,
	selectors: {
		"&:hover": { color: vars.color.ink },
	},
});

export const title = style({
	fontFamily: vars.font.display,
	fontSize: textSize.lg,
	fontWeight: 600,
	letterSpacing: "0.08em",
	color: vars.color.ink,
	flex: 1,
});

export const topRight = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
});

export const iconBtn = style({
	color: vars.color.inkMuted,
	background: "none",
	border: "none",
	fontSize: textSize.base,
	cursor: "pointer",
	padding: "2px 4px",
	opacity: 0.7,
	selectors: {
		"&:hover": { opacity: 1 },
	},
});

export const addLink = style({
	fontSize: textSize.sm,
	color: vars.color.white,
	textDecoration: "none",
	fontWeight: 500,
	padding: `${space.xs} 12px`,
	border: "none",
	borderRadius: radius.md,
	background: vars.color.accent,
	selectors: {
		"&:hover": { background: vars.color.accentStrong },
	},
});

export const manageLink = style({
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	textDecoration: "none",
	padding: `${space.xs} 10px`,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised, color: vars.color.ink },
	},
});

export const cardArea = style({
	flex: 1,
	padding: `${space.lg} 20px`,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	"@media": {
		"(max-width: 600px)": { padding: `${space.md} 12px` },
	},
});
