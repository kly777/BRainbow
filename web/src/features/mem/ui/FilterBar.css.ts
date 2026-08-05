/**
 * FilterBar — 标签过滤栏（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const filterBar = style({
	display: "flex",
	flexWrap: "wrap",
	alignItems: "center",
	gap: "4px",
	padding: "4px 20px",
	borderBottom: `1px solid ${vars.color.border}`,
	background: vars.color.surface,
	flexShrink: 0,
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const tagModeBtn = style({
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.color.inkMuted,
	padding: "2px 8px",
	cursor: "pointer",
	selectors: {
		"&:hover": { color: vars.color.ink, background: vars.color.surfaceRaised },
	},
});

export const tagChipActive = style({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.color.badgeNewBg,
	color: vars.color.badgeNewText,
});

export const tagChipExcluded = style({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.color.badgeSuspendedBg,
	color: vars.color.badgeSuspendedText,
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

export const tagClearAll = style({
	fontSize: textSize.xs,
	border: "none",
	background: "none",
	color: vars.color.inkFaint,
	cursor: "pointer",
	padding: "2px 6px",
	selectors: {
		"&:hover": { color: vars.color.ink },
	},
});

export const tagSearchInput = style({
	flex: 1,
	minWidth: 120,
	fontSize: textSize.xs,
	border: "1px solid transparent",
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.color.ink,
	padding: "2px 8px",
	selectors: {
		"&::placeholder": { color: vars.color.inkFaint },
		"&:focus": {
			borderColor: vars.color.borderStrong,
			background: vars.color.surfaceRaised,
		},
	},
});

export const tagDropdown = style({
	position: "absolute",
	top: "calc(100% + 2px)",
	left: 20,
	right: 20,
	zIndex: 20,
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	boxShadow: "0 4px 12px rgb(0 0 0 / 8%)",
	maxHeight: 200,
	overflowY: "auto",
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
	color: vars.color.ink,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});
