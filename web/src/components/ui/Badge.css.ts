/**
 * Badge — 状态徽章（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const badge = style({
	display: "inline-block",
	fontSize: textSize.xs,
	padding: `${space.xs} ${space.sm}`,
	borderRadius: radius.md,
	fontWeight: 500,
	lineHeight: 1.2,
});

export const default_ = style({
	background: vars.color.bg,
	color: vars.color.inkMuted,
});

export const new_ = style({
	background: vars.color.badgeNewBg,
	color: vars.color.badgeNewText,
});

export const learning = style({
	background: vars.color.badgeLearningBg,
	color: vars.color.badgeLearningText,
});

export const review = style({
	background: vars.color.badgeReviewBg,
	color: vars.color.badgeReviewText,
});

export const relearning = style({
	background: vars.color.badgeRelearningBg,
	color: vars.color.badgeRelearningText,
});

export const suspended = style({
	background: vars.color.badgeSuspendedBg,
	color: vars.color.badgeSuspendedText,
});

export const success = style({
	background: vars.color.successSubtle,
	color: vars.color.success,
});

export const warning = style({
	background: vars.color.warningSubtle,
	color: vars.color.warning,
});

export const danger = style({
	background: vars.color.dangerSubtle,
	color: vars.color.danger,
});

export const info = style({
	background: vars.color.accentSoft,
	color: vars.color.accent,
});
