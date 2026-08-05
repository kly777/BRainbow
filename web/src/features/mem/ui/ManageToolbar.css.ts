/**
 * ManageToolbar — 管理工具栏（vanilla-extract 迁移）
 * 按钮复用 base.css.ts（exportBtn = btnGhost 紧凑变体）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../styles/tokens.css.ts";

export const toolbar = style({
	display: "flex",
	alignItems: "center",
	flexWrap: "wrap",
	gap: space.sm,
	padding: `${space.sm} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
});

export const searchBox = style({
	flex: 1,
	minWidth: 160,
	maxWidth: 280,
});

export const searchInput = style({
	width: "100%",
	fontSize: textSize.sm,
	color: vars.v2.ink,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: `${space.xs} 12px`,
	selectors: {
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const tagFilter = style({
	display: "flex",
	alignItems: "center",
	gap: 4,
	position: "relative",
	flexWrap: "wrap",
});

export const modeToggle = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.v2.inkMuted,
	padding: "3px 8px",
	cursor: "pointer",
	selectors: {
		"&:hover": { color: vars.v2.ink, background: vars.v2.surfaceRaised },
	},
});

export const activeTag = style({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
});

export const excludedTag = style({
	display: "inline-flex",
	alignItems: "center",
	gap: 4,
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.v2.badgeSuspendedBg,
	color: vars.v2.badgeSuspendedText,
});

export const tagClear = style({
	background: "none",
	border: "none",
	cursor: "pointer",
	fontSize: 10,
	color: "inherit",
	padding: 0,
	opacity: 0.6,
	selectors: {
		"&:hover": { opacity: 1 },
	},
});

export const clearAllBtn = style({
	fontSize: textSize.xs,
	border: "none",
	background: "none",
	color: vars.v2.inkFaint,
	cursor: "pointer",
	padding: "2px 6px",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const tagInput = style({
	fontSize: textSize.xs,
	width: 120,
	color: vars.v2.ink,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	padding: "3px 8px",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent },
	},
});

export const tagDropdown = style({
	position: "absolute",
	top: "calc(100% + 4px)",
	left: 0,
	zIndex: 20,
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	boxShadow: "0 4px 12px rgb(0 0 0 / 8%)",
});

export const tagOption = style({
	display: "block",
	width: "100%",
	textAlign: "left",
	fontSize: textSize.sm,
	padding: "6px 12px",
	border: "none",
	background: "none",
	cursor: "pointer",
	color: vars.v2.ink,
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised },
	},
});

export const exportBtn = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	background: "transparent",
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.md,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
	},
});

export const filterGroup = style({
	display: "flex",
	gap: 2,
});

export const filterBtn = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkMuted,
	background: "transparent",
	border: "none",
	borderRadius: `calc(${radius.md} - 2px)`,
	padding: "3px 8px",
	cursor: "pointer",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const filterActive = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.white,
	background: vars.v2.accent,
	border: "none",
	borderRadius: `calc(${radius.md} - 2px)`,
	padding: "3px 8px",
	cursor: "pointer",
});
