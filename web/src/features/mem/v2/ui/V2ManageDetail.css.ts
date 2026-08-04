/**
 * V2ManageDetail — 档案卡详情侧栏（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../../styles/tokens.css.ts";

export {
	btnGhost as ghostBtn,
	btnPrimary as primaryBtn,
} from "../../../../styles/base.css.ts";

export const detail = style({
	width: 0,
	overflow: "hidden",
	flexShrink: 0,
	borderLeft: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
	transition: "width 0.25s ease",
	display: "flex",
	flexDirection: "column",
});

export const detailOpen = style({
	width: 380,
	"@media": {
		"(max-width: 768px)": { width: "min(90vw, 360px)" },
	},
});

export const detailEmpty = style({
	padding: space.xl,
	color: vars.v2.inkFaint,
	fontSize: textSize.sm,
	textAlign: "center",
});

export const detailCard = style({
	flex: 1,
	overflowY: "auto",
	padding: space.md,
	display: "flex",
	flexDirection: "column",
	gap: space.md,
});

export const detailHead = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	paddingBottom: space.sm,
	borderBottom: `1px solid ${vars.v2.border}`,
});

export const detailHeadRight = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
});

export const detailClose = style({
	background: "none",
	border: "none",
	color: vars.v2.inkFaint,
	cursor: "pointer",
	fontSize: 13,
	padding: "2px 6px",
	borderRadius: 4,
	selectors: {
		"&:hover": { color: vars.v2.ink, background: vars.v2.surfaceRaised },
	},
});

export const detailId = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.base,
	fontWeight: 600,
	color: vars.v2.ink,
});

export const detailState = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	padding: "2px 8px",
	borderRadius: 999,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
	selectors: {
		'&[data-state="learning"], &[data-state="relearning"]': {
			background: vars.v2.badgeLearningBg,
			color: vars.v2.badgeLearningText,
		},
		'&[data-state="review"]': {
			background: vars.v2.badgeReviewBg,
			color: vars.v2.badgeReviewText,
		},
		'&[data-state="suspended"]': {
			background: vars.v2.badgeSuspendedBg,
			color: vars.v2.badgeSuspendedText,
		},
	},
});

export const detailSection = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	overflow: "hidden",
});

export const detailTab = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: 11,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.inkMuted,
	padding: `${space.sm} ${space.md}`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const detailBody = style({
	padding: space.md,
	fontSize: textSize.sm,
	lineHeight: 1.7,
	color: vars.v2.ink,
});

export const editArea = style({
	width: "100%",
	padding: space.md,
	border: "none",
	borderRadius: 0,
	fontSize: textSize.base,
	fontFamily: vars.v2.fontMono,
	lineHeight: 1.6,
	resize: "vertical",
	background: vars.v2.bg,
	color: vars.v2.ink,
	boxSizing: "border-box",
	outline: "none",
	transition: "box-shadow 0.15s",
	selectors: {
		"&:focus": { boxShadow: `inset 0 0 0 2px ${vars.v2.accentSoft}` },
	},
});

export const meta = style({
	display: "flex",
	flexWrap: "wrap",
	gap: "4px 12px",
	fontSize: 11,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	fontVariantNumeric: "tabular-nums",
});

export const detailActions = style({
	display: "flex",
	flexWrap: "wrap",
	gap: space.xs,
	paddingTop: space.sm,
	borderTop: `1px solid ${vars.v2.border}`,
});

export const dangerBtn = style({
	fontSize: textSize.sm,
	color: vars.v2.white,
	background: vars.v2.danger,
	border: "none",
	borderRadius: radius.md,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	marginLeft: "auto",
	selectors: {
		"&:hover": { filter: "brightness(0.92)" },
	},
});

export const empty = style({
	textAlign: "center",
	padding: `${space.xl} 0`,
	color: vars.v2.inkFaint,
});
