/**
 * EditTaskModal — 编辑任务弹窗（vanilla-extract 迁移，v2 令牌）
 * 共享：EditTaskModal + TimeWindowsTab + BasicInfoTab + DependenciesTab
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const editModal = style({
	display: "flex",
	flexDirection: "column",
	minHeight: 420,
});

export const tabBar = style({
	display: "flex",
	gap: 0,
	borderBottom: `2px solid ${vars.v2.border}`,
	marginBottom: 0,
	flexShrink: 0,
});

export const tab = style({
	flex: 1,
	padding: `${space.sm} 12px`,
	background: "none",
	border: "none",
	borderBottom: "2px solid transparent",
	marginBottom: -2,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.inkMuted,
	transition: "all 0.15s",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.xs,
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const tabActive = style({
	color: vars.v2.accent,
	borderBottomColor: vars.v2.accent,
});

export const tabCount = style({
	fontSize: textSize.xs,
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
	padding: space.xs,
	borderRadius: radius.md,
	fontWeight: 600,
});

export const tabContent = style({
	padding: `${space.lg} 0 0 0`,
	flex: 1,
	overflowY: "auto",
	maxHeight: "55vh",
});

export const field = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
	marginBottom: space.md,
	flex: 1,
	minWidth: 0,
});

export const fieldLabel = style({
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.ink,
});

const fieldInputBase = {
	padding: `${space.sm} 10px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	color: vars.v2.ink,
	transition: "border-color 0.15s",
	background: vars.v2.surface,
	width: "100%",
	boxSizing: "border-box",
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
} as const;

export const fieldInput = style(fieldInputBase);
export const fieldSelect = style(fieldInputBase);

export const fieldTextarea = style({
	padding: `${space.sm} 10px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	resize: "vertical",
	minHeight: 60,
	fontFamily: "inherit",
	transition: "border-color 0.15s",
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const fieldRow = style({
	display: "flex",
	gap: space.md,
});

globalStyle(`${fieldRow} > .${field}`, {
	flex: 1,
});

export const presets = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
	flexWrap: "wrap",
	marginBottom: space.md,
});

export const presetsLabel = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	flexShrink: 0,
});

export const presetBtn = style({
	padding: `${space.xs} 10px`,
	fontSize: textSize.sm,
	background: vars.v2.successSubtle,
	color: "oklch(0.4 0.1 170)",
	border: `1px solid ${vars.v2.successSubtle}`,
	borderRadius: radius.sm,
	cursor: "pointer",
	transition: "all 0.15s",
	whiteSpace: "nowrap",
	selectors: {
		"&:hover": { background: vars.v2.successSubtle, borderColor: "oklch(0.88 0.08 160)" },
	},
});

export const addTimeBlock = style({
	background: vars.v2.bg,
	border: `1px dashed ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: space.md,
	marginBottom: space.md,
});

export const addBtn = style({
	padding: `${space.xs} 14px`,
	background: vars.v2.accent,
	color: vars.v2.white,
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	transition: "background 0.15s",
	marginTop: 4,
	selectors: {
		"&:hover": { background: vars.v2.accentStrong },
		"&:disabled": { background: vars.v2.border, cursor: "not-allowed" },
	},
});

export const sectionHeader = style({
	display: "flex",
	alignItems: "baseline",
	gap: space.sm,
	marginBottom: space.sm,
});

export const sectionTitle = style({
	fontSize: textSize.sm,
	fontWeight: 600,
	color: vars.v2.ink,
});

export const sectionHint = style({
	fontSize: textSize.xs,
	color: vars.v2.inkMuted,
});

export const timeList = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
	marginBottom: 4,
});

export const timeItem = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: `${space.xs} 10px`,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
});

export const timeItemText = style({
	color: vars.v2.ink,
	flex: 1,
});

export const timeDelete = style({
	background: "none",
	border: "none",
	color: vars.v2.danger,
	fontSize: textSize.lg,
	cursor: "pointer",
	padding: `0 ${space.xs}`,
	lineHeight: 1,
	flexShrink: 0,
});

export const emptyMsg = style({
	color: vars.v2.border,
	fontSize: textSize.sm,
	padding: `${space.md} 0`,
	textAlign: "center",
});

export const errorMsg = style({
	color: vars.v2.danger,
	fontSize: textSize.sm,
	marginTop: 6,
	padding: `${space.xs} 10px`,
	background: vars.v2.dangerSubtle,
	borderRadius: radius.sm,
});

export const depList = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
	marginBottom: space.md,
});

export const depItem = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: `${space.sm} 10px`,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
});

export const depInfo = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	flex: 1,
	minWidth: 0,
});

export const depTitle = style({
	fontSize: textSize.sm,
	color: vars.v2.ink,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const depStatus = style({
	fontSize: textSize.xs,
	padding: `${space.xs} 6px`,
	borderRadius: radius.sm,
	fontWeight: 500,
	flexShrink: 0,
});

export const depStatusBacklog = style({
	background: vars.v2.border,
	color: vars.v2.inkMuted,
});

export const depStatusActive = style({
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
});

export const depStatusCompleted = style({
	background: vars.v2.successSubtle,
	color: "oklch(0.4 0.1 170)",
});

export const depStatusArchived = style({
	background: vars.v2.surfaceRaised,
	color: vars.v2.inkMuted,
});

export const depRemove = style({
	background: "none",
	border: "none",
	color: vars.v2.danger,
	fontSize: textSize.lg,
	cursor: "pointer",
	padding: `0 ${space.xs}`,
	lineHeight: 1,
	flexShrink: 0,
});

export const addDepBlock = style({
	marginTop: space.md,
	padding: space.md,
	background: vars.v2.bg,
	border: `1px dashed ${vars.v2.border}`,
	borderRadius: radius.md,
});

export const addDepRow = style({
	display: "flex",
	gap: space.sm,
	alignItems: "flex-end",
});

export const cancelBtn = style({
	padding: `${space.sm} 18px`,
	background: vars.v2.surfaceRaised,
	color: vars.v2.ink,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	transition: "all 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.border },
	},
});

export const saveBtn = style({
	padding: `${space.sm} 18px`,
	background: vars.v2.success,
	color: vars.v2.white,
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	transition: "background 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.success },
	},
});
