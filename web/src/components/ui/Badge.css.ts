/**
 * Badge — 状态徽章（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const badge = style({
	display: "inline-block",
	fontSize: textSize.xs,
	padding: `${space.xs} ${space.sm}`,
	borderRadius: radius.md,
	fontWeight: 500,
	lineHeight: 1.2,
});

export const default_ = style({
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
});

export const new_ = style({
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
});

export const learning = style({
	background: vars.v2.badgeLearningBg,
	color: vars.v2.badgeLearningText,
});

export const review = style({
	background: vars.v2.badgeReviewBg,
	color: vars.v2.badgeReviewText,
});

export const relearning = style({
	background: vars.v2.badgeRelearningBg,
	color: vars.v2.badgeRelearningText,
});

export const suspended = style({
	background: vars.v2.badgeSuspendedBg,
	color: vars.v2.badgeSuspendedText,
});

export const success = style({
	background: vars.v2.successSubtle,
	color: vars.v2.success,
});

export const warning = style({
	background: vars.v2.warningSubtle,
	color: vars.v2.warning,
});

export const danger = style({
	background: vars.v2.dangerSubtle,
	color: vars.v2.danger,
});

export const info = style({
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
});
