/**
 * ManageBatchBar — 批量操作条（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const batchBar = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: space.md,
	padding: "0 20px",
	maxHeight: 0,
	overflow: "hidden",
	background: vars.color.accentSoft,
	borderBottom: `1px solid transparent`,
	transition: "max-height 0.2s ease, padding 0.2s ease",
});

export const batchBarVisible = style({
	maxHeight: 56,
	padding: `${space.sm} 20px`,
	borderBottomColor: vars.color.border,
});

export const batchCount = style({
	fontSize: 12,
	fontFamily: vars.font.mono,
	color: vars.color.accentStrong,
	fontVariantNumeric: "tabular-nums",
});

export const batchActions = style({
	display: "flex",
	gap: space.xs,
});

export const batchBtn = style({
	fontSize: textSize.sm,
	color: vars.color.ink,
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});

export const batchBtnDanger = style({
	fontSize: textSize.sm,
	color: vars.color.white,
	background: vars.color.danger,
	border: "none",
	borderRadius: radius.md,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	selectors: {
		"&:hover": { filter: "brightness(0.92)" },
	},
});
