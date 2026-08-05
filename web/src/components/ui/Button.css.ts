/**
 * Button — 通用按钮（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const btn = style({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.xs,
	borderRadius: radius.md,
	fontFamily: "inherit",
	fontWeight: 500,
	cursor: "pointer",
	lineHeight: 1.15,
	whiteSpace: "nowrap",
	transition:
		"background 0.15s, border-color 0.15s, transform 0.15s",
	selectors: {
		"&:active:not(:disabled)": { transform: "scale(0.97)" },
		"&:disabled": { opacity: 0.5, cursor: "not-allowed" },
	},
});

export const sm = style({
	padding: `${space.xs} 10px`,
	fontSize: textSize.sm,
});

export const md = style({
	padding: `${space.xs} 14px`,
	fontSize: textSize.base,
});

export const primary = style({
	background: vars.v2.accent,
	color: vars.v2.bg,
	border: "none",
	selectors: {
		"&:hover:not(:disabled)": { background: vars.v2.accentStrong },
	},
});

export const secondary = style({
	background: vars.v2.bg,
	color: vars.v2.inkMuted,
	border: `1px solid ${vars.v2.border}`,
	selectors: {
		"&:hover:not(:disabled)": {
			background: vars.v2.surfaceRaised,
			color: vars.v2.ink,
		},
	},
});

export const danger = style({
	background: vars.v2.bg,
	color: vars.v2.danger,
	border: `1px solid ${vars.v2.danger}`,
	selectors: {
		"&:hover:not(:disabled)": { background: vars.v2.dangerSubtle },
	},
});

export const ghost = style({
	background: "transparent",
	color: vars.v2.inkFaint,
	border: "1px solid transparent",
	selectors: {
		"&:hover:not(:disabled)": {
			background: vars.v2.bg,
			color: vars.v2.ink,
		},
	},
});

export const icon = style({
	background: "transparent",
	color: vars.v2.inkFaint,
	border: "none",
	borderRadius: radius.sm,
	width: 22,
	height: 22,
	padding: 0,
	fontSize: textSize.base,
	lineHeight: 1,
	selectors: {
		"&:hover:not(:disabled)": {
			background: vars.v2.dangerSubtle,
			color: vars.v2.danger,
		},
	},
});

// 变体映射（vanilla-extract 不支持动态索引，组件里用此表）
export const variants: Record<string, string> = {
	primary,
	secondary,
	danger,
	ghost,
	icon,
	sm,
	md,
};
