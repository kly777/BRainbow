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
	background: vars.v2.surface,
	padding: space.xl,
	borderRadius: radius.lg,
	display: "flex",
	flexDirection: "column",
	gap: space.md,
	minWidth: 300,
	maxWidth: 360,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.15)",
	border: `1px solid ${vars.v2.border}`,
});

export const title = style({
	margin: 0,
	fontSize: textSize.lg,
	color: vars.v2.ink,
	textAlign: "center",
});

export const error = style({
	color: vars.v2.danger,
	fontSize: textSize.sm,
	margin: 0,
	textAlign: "center",
});

export const input = style({
	padding: `${space.sm} 12px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	background: vars.v2.bg,
	color: vars.v2.ink,
	outline: "none",
	selectors: {
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
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
	background: vars.v2.accent,
	color: vars.v2.white,
	fontSize: textSize.base,
	fontWeight: 600,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.v2.accentStrong },
	},
});

export const btnLink = style({
	background: "none",
	border: "none",
	color: vars.v2.accent,
	fontSize: textSize.sm,
	cursor: "pointer",
	padding: space.xs,
	selectors: {
		"&:hover": { textDecoration: "underline" },
	},
});

export const btnCancel = style({
	padding: `${space.sm} 0`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: "transparent",
	color: vars.v2.inkMuted,
	fontSize: textSize.sm,
	cursor: "pointer",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});
