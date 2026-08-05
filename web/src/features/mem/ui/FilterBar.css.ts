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
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
	flexShrink: 0,
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const tagModeBtn = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.v2.inkMuted,
	padding: "2px 8px",
	cursor: "pointer",
	selectors: {
		"&:hover": { color: vars.v2.ink, background: vars.v2.surfaceRaised },
	},
});

export const tagChipActive = style({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
	fontSize: textSize.xs,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
});

export const tagChipExcluded = style({
	display: "inline-flex",
	alignItems: "center",
	gap: "4px",
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

export const tagClearAll = style({
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

export const tagSearchInput = style({
	flex: 1,
	minWidth: 120,
	fontSize: textSize.xs,
	border: "1px solid transparent",
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.v2.ink,
	padding: "2px 8px",
	selectors: {
		"&::placeholder": { color: vars.v2.inkFaint },
		"&:focus": {
			borderColor: vars.v2.borderStrong,
			background: vars.v2.surfaceRaised,
		},
	},
});

export const tagDropdown = style({
	position: "absolute",
	top: "calc(100% + 2px)",
	left: 20,
	right: 20,
	zIndex: 20,
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
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
	color: vars.v2.ink,
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised },
	},
});
