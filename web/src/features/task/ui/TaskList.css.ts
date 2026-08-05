/**
 * TaskList — 任务列表（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../styles/tokens.css.ts";

export const taskListPanel = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xl,
	flex: 1,
	minHeight: 0,
	overflowY: "auto",
});

// 状态分组容器（原 CSS 未定义样式，仅作标记）
export const statusSection = style({});

export const statusTitle = style({
	margin: `0 0 ${space.md}`,
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.inkMuted,
	textTransform: "uppercase",
	letterSpacing: "0.08em",
	display: "flex",
	alignItems: "center",
	gap: space.sm,
});

export const statusIndicator = style({
	width: 6,
	height: 6,
	borderRadius: "50%",
	display: "inline-block",
	flexShrink: 0,
});

export const statusBacklog = style({ background: vars.v2.border });
export const statusActive = style({ background: vars.v2.accent });
export const statusCompleted = style({ background: vars.v2.success });
export const statusArchived = style({ background: vars.v2.border });

export const taskList = style({
	display: "flex",
	flexDirection: "column",
});

export const taskItem = style({
	display: "flex",
	flexDirection: "column",
	padding: `${space.lg} 0`,
	borderBottom: `1px solid ${vars.v2.surfaceRaised}`,
	transition: "background 0.15s ease",
	selectors: {
		"&:first-child": { borderTop: `1px solid ${vars.v2.surfaceRaised}` },
		"&:hover": { background: vars.v2.surface },
	},
});

export const taskRow = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	gap: space.xl,
	"@media": {
		"(max-width: 768px)": { flexDirection: "column", gap: space.sm },
	},
});

export const taskMain = style({
	flex: 1,
	minWidth: 0,
});

export const taskTitle = style({
	margin: `0 0 ${space.xs}`,
	fontSize: textSize.base,
	fontWeight: 500,
	color: vars.v2.ink,
	lineHeight: 1.5,
	letterSpacing: "-0.01em",
});

export const taskDescription = style({
	margin: `0 0 ${space.sm}`,
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	lineHeight: 1.6,
});

export const taskMeta = style({
	display: "flex",
	gap: space.md,
	alignItems: "center",
	flexWrap: "wrap",
});

export const dateBadge = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
});

export const timeWindowChips = style({
	display: "flex",
	flexWrap: "wrap",
	gap: space.xs,
	marginTop: 6,
});

export const timeWindowChip = style({
	fontSize: textSize.xs,
	padding: `${space.xs} 8px`,
	borderRadius: radius.sm,
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
	border: `1px solid ${vars.v2.surfaceRaised}`,
	whiteSpace: "nowrap",
});

export const subTaskBadge = style({
	marginLeft: 8,
	padding: space.xs,
	borderRadius: radius.sm,
	fontSize: textSize.xs,
	fontWeight: 500,
	color: vars.v2.inkMuted,
	background: vars.v2.surfaceRaised,
	verticalAlign: "middle",
});

export const taskActions = style({
	display: "flex",
	gap: space.xs,
	alignItems: "center",
	flexShrink: 0,
	"@media": {
		"(max-width: 768px)": { width: "100%", justifyContent: "flex-end" },
	},
});

const selectArrow =
	"url(\"data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%239ca3af' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")";

export const statusSelect = style({
	padding: `${space.xs} 24px ${space.xs} 10px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	color: vars.v2.ink,
	background: `${vars.v2.surface} ${selectArrow} no-repeat right 8px center`,
	cursor: "pointer",
	outline: "none",
	transition: "border-color 0.15s",
	appearance: "none",
	WebkitAppearance: "none",
	selectors: {
		"&:hover": { borderColor: vars.v2.border },
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const editButton = style({
	padding: `${space.xs} 10px`,
	background: "none",
	color: vars.v2.inkMuted,
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.base,
	transition: "all 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
	},
});

export const subTaskButton = style({
	padding: `${space.xs} 10px`,
	background: "none",
	color: vars.v2.inkMuted,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.base,
	fontWeight: 500,
	transition: "all 0.15s",
	lineHeight: 1.4,
	selectors: {
		"&:hover": {
			background: vars.v2.bg,
			color: vars.v2.ink,
			borderColor: vars.v2.border,
		},
	},
});

export const deleteButton = style({
	padding: `${space.xs} 10px`,
	background: "none",
	color: vars.v2.inkMuted,
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.base,
	transition: "all 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.dangerSubtle, color: vars.v2.danger },
	},
});

export const subTaskForm = style({
	display: "flex",
	gap: space.sm,
	alignItems: "center",
	marginTop: 10,
	padding: `${space.sm} 0 0`,
	borderTop: `1px solid ${vars.v2.surfaceRaised}`,
});

export const subTaskInput = style({
	flex: 1,
	padding: `${space.sm} ${space.md}`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	background: vars.v2.surface,
	outline: "none",
	transition: "border-color 0.15s",
	selectors: {
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
		"&::placeholder": { color: vars.v2.border },
	},
});

export const subTaskCancel = style({
	padding: `${space.sm} ${space.md}`,
	background: "none",
	color: vars.v2.inkMuted,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	whiteSpace: "nowrap",
	transition: "all 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
	},
});

export const childList = style({
	display: "flex",
	flexDirection: "column",
	marginTop: 0,
	marginLeft: 20,
	paddingLeft: 16,
	borderLeft: `2px solid ${vars.v2.surfaceRaised}`,
});

globalStyle(`${childList} > .${taskItem}`, {
	padding: `${space.md} 0`,
});

export const childItem = style({
	padding: `${space.md} 0`,
});
