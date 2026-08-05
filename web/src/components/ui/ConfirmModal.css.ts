/**
 * ConfirmModal — 确认对话框（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const overlay = style({
	position: "fixed",
	inset: 0,
	background: "oklch(0 0 0 / 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 1100,
	padding: space.xl,
});

export const dialog = style({
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.lg,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.15)",
	maxWidth: 420,
	width: "100%",
	padding: space.xl,
	display: "flex",
	flexDirection: "column",
	gap: space.lg,
});

export const header = style({
	display: "flex",
	alignItems: "flex-start",
	gap: space.md,
});

export const iconWrap = style({
	flexShrink: 0,
	width: 36,
	height: 36,
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	fontSize: 18,
	lineHeight: 1,
});

export const iconDanger = style({
	background: vars.color.dangerSubtle,
	color: vars.color.danger,
});

export const iconWarning = style({
	background: vars.color.warningSubtle,
	color: vars.color.warning,
});

export const iconInfo = style({
	background: vars.color.accentSoft,
	color: vars.color.accent,
});

export const titleWrap = style({
	flex: 1,
	minWidth: 0,
});

export const title = style({
	margin: 0,
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.color.ink,
	lineHeight: 1.3,
});

export const message = style({
	margin: `${space.xs} 0 0`,
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	lineHeight: 1.5,
});

export const actions = style({
	display: "flex",
	justifyContent: "flex-end",
	gap: space.sm,
	marginTop: space.xs,
});

export const btn = style({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: `${space.xs} ${space.lg}`,
	borderRadius: radius.md,
	fontFamily: "inherit",
	fontSize: textSize.sm,
	fontWeight: 500,
	cursor: "pointer",
	lineHeight: 1.4,
	transition: "background 0.15s, box-shadow 0.15s",
	border: "none",
	selectors: {
		"&:focus-visible": {
			outline: `2px solid ${vars.color.accent}`,
			outlineOffset: 2,
		},
	},
});

export const btnCancel = style({
	background: vars.color.bg,
	color: vars.color.inkMuted,
	border: `1px solid ${vars.color.border}`,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised, color: vars.color.ink },
	},
});

export const btnDanger = style({
	background: vars.color.danger,
	color: "oklch(1 0 0)",
	selectors: {
		"&:hover": { background: "oklch(0.48 0.18 25)" },
	},
});

export const btnWarning = style({
	background: vars.color.warning,
	color: "oklch(1 0 0)",
	selectors: {
		"&:hover": { background: "oklch(0.52 0.14 85)" },
	},
});

export const btnPrimary = style({
	background: vars.color.accent,
	color: "oklch(1 0 0)",
	selectors: {
		"&:hover": { background: vars.color.accentStrong },
	},
});
