/**
 * Sidebar — 目录索引抽屉（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { space, textSize, vars } from "@styles/tokens.css.ts";

export const sidebar = style({
	width: 0,
	overflow: "hidden",
	borderRight: `1px solid ${vars.color.border}`,
	background: vars.color.surface,
	transition: "width 0.2s ease",
	display: "flex",
	flexDirection: "column",
	flexShrink: 0,
});

export const sidebarOpen = style({
	width: 240,
});

export const sidebarHeader = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	padding: `${space.md} 14px`,
	borderBottom: `1px solid ${vars.color.border}`,
	fontFamily: vars.font.display,
	fontSize: textSize.sm,
	fontWeight: 600,
});

export const sidebarClose = style({
	background: "none",
	border: "none",
	fontSize: textSize.sm,
	color: vars.color.inkFaint,
	cursor: "pointer",
	padding: `${space.xs} 6px`,
	selectors: {
		"&:hover": { color: vars.color.ink },
	},
});

export const legend = style({
	display: "flex",
	flexWrap: "wrap",
	gap: "4px 10px",
	padding: `${space.sm} 14px`,
	borderBottom: `1px solid ${vars.color.border}`,
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	color: vars.color.inkFaint,
});

export const legendItem = style({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	whiteSpace: "nowrap",
});

export const dot = style({
	width: 7,
	height: 7,
	borderRadius: "50%",
	display: "inline-block",
});

export const dotNew = style({ background: vars.color.badgeNewText });
export const dotLearning = style({ background: vars.color.badgeLearningText });
export const dotReview = style({ background: vars.color.badgeReviewText });
export const dotBuried = style({ background: vars.color.inkFaint });
export const dotSuspended = style({ background: vars.color.badgeSuspendedText });

export const sidebarList = style({
	flex: 1,
	overflowY: "auto",
	padding: space.xs,
});

export const sidebarItem = style({
	display: "flex",
	alignItems: "center",
	gap: "8px",
	width: "100%",
	padding: "8px 10px",
	marginBottom: 2,
	border: "none",
	background: "transparent",
	color: vars.color.ink,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});

export const sidebarActive = style({
	background: vars.color.accentSoft,
});

export const sidebarIdx = style({
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	color: vars.color.inkFaint,
	flexShrink: 0,
	fontVariantNumeric: "tabular-nums",
});

export const sidebarText = style({
	flex: 1,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const sidebarState = style({
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	flexShrink: 0,
	color: vars.color.inkFaint,
});
