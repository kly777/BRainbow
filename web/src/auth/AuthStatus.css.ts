/**
 * AuthStatus — 登录/注册表单（vanilla-extract 迁移，v2 令牌）
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
	zIndex: 1000,
});

export const form = style({
	background: vars.color.surface,
	padding: space.xl,
	borderRadius: radius.lg,
	display: "flex",
	flexDirection: "column",
	gap: space.md,
	minWidth: 300,
	maxWidth: 360,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.15)",
	border: `1px solid ${vars.color.border}`,
});

export const title = style({
	margin: 0,
	fontSize: textSize.lg,
	color: vars.color.ink,
	textAlign: "center",
});

export const error = style({
	color: vars.color.danger,
	fontSize: textSize.sm,
	margin: 0,
	textAlign: "center",
});

export const input = style({
	padding: `${space.sm} 12px`,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	background: vars.color.bg,
	color: vars.color.ink,
	outline: "none",
	selectors: {
		"&:focus": {
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
		},
	},
});

export const actions = style({
	display: "flex",
	flexDirection: "column",
	gap: space.sm,
});

export const btnSubmit = style({
	padding: `${space.sm} 0`,
	border: "none",
	borderRadius: radius.md,
	background: vars.color.accent,
	color: vars.color.white,
	fontSize: textSize.base,
	fontWeight: 600,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.color.accentStrong },
	},
});

export const btnLink = style({
	background: "none",
	border: "none",
	color: vars.color.accent,
	fontSize: textSize.sm,
	cursor: "pointer",
	padding: space.xs,
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const btnCancel = style({
	padding: `${space.sm} 0`,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: "transparent",
	color: vars.color.inkMuted,
	fontSize: textSize.sm,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.color.bg },
	},
});
