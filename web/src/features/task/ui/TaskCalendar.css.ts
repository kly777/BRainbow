/**
 * TaskCalendar — 日历视图（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const calendarView = style({
	background: vars.color.surface,
	borderRadius: radius.lg,
	padding: space.xl,
	boxShadow: "0 1px 3px oklch(0 0 0 / 0.1)",
});

export const calendarHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: space.xl,
});

export const calendarTitle = style({
	margin: 0,
	fontSize: textSize.xl,
	color: vars.color.ink,
});

export const navButton = style({
	color: vars.color.ink,
	padding: `${space.sm} 16px`,
	background: vars.color.surfaceRaised,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.base,
	transition: "all 0.2s",
	selectors: {
		"&:hover": { background: vars.color.border },
	},
});

export const calendarGrid = style({
	display: "grid",
	gridTemplateColumns: "repeat(7, 1fr)",
	gap: space.xs,
	background: vars.color.border,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	overflow: "hidden",
});

export const dayHeader = style({
	background: vars.color.bg,
	padding: space.md,
	textAlign: "center",
	fontWeight: 600,
	color: vars.color.ink,
	fontSize: textSize.base,
});

// 标记类（与 calendarDay 组合使用）
export const today = style({});
export const empty = style({});

export const calendarDay = style({
	background: vars.color.surface,
	minHeight: 100,
	padding: space.sm,
	borderRight: `1px solid ${vars.color.border}`,
	borderBottom: `1px solid ${vars.color.border}`,
	selectors: {
		[`&.${today}`]: {
			background: vars.color.accentSoft,
			boxShadow: `inset 0 0 0 2px ${vars.color.accent}`,
			borderRadius: radius.sm,
		},
		[`&.${empty}`]: { background: vars.color.bg },
	},
});

export const dayNumber = style({
	fontWeight: 600,
	color: vars.color.ink,
	marginBottom: space.sm,
	fontSize: textSize.base,
});

// 今天高亮时 dayNumber 颜色
export const dayNumberToday = style({
	color: vars.color.accent,
});

globalStyle(`.${today} .dayNumber`, {
	color: vars.color.accent,
});

export const dayTasks = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
});

export const dayTask = style({
	padding: `${space.xs} 8px`,
	borderRadius: radius.sm,
	fontSize: textSize.xs,
	whiteSpace: "nowrap",
	overflow: "hidden",
	textOverflow: "ellipsis",
	display: "flex",
	alignItems: "center",
	gap: space.xs,
});

export const eventTime = style({
	fontSize: textSize.xs,
	opacity: 0.8,
	flexShrink: 0,
});

export const typeFeasible = style({
	background: vars.color.border,
	borderLeft: `3px solid ${vars.color.inkMuted}`,
});

export const typePlanned = style({
	background: vars.color.accentSoft,
	borderLeft: `3px solid ${vars.color.accent}`,
});

export const typeActual = style({
	background: vars.color.successSubtle,
	borderLeft: `3px solid ${vars.color.success}`,
});
