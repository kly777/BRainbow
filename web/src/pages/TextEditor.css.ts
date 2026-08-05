/**
 * TextEditor — 文本编辑器（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const page = style({
	display: "flex",
	flexDirection: "column",
	height: "100vh",
	background: vars.color.bg,
});

export const tabs = style({
	display: "flex",
	alignItems: "center",
	gap: 0,
	padding: `0 ${space.xs}`,
	borderBottom: `1px solid ${vars.color.border}`,
	background: vars.color.surface,
	flexShrink: 0,
	overflowX: "auto",
});

export const tab = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
	padding: `${space.sm} 14px`,
	fontSize: textSize.sm,
	cursor: "pointer",
	border: "none",
	background: "transparent",
	color: vars.color.inkMuted,
	borderBottom: "2px solid transparent",
	transition: "color 0.15s, border-color 0.15s",
	whiteSpace: "nowrap",
	userSelect: "none",
	selectors: {
		"&:hover": { color: vars.color.ink },
		"&:focus-visible": {
			outline: `2px solid ${vars.color.accent}`,
			outlineOffset: -2,
		},
	},
});

export const tabActive = style({
	color: vars.color.ink,
	borderBottomColor: vars.color.accent,
});

export const renameInput = style({
	width: 80,
	padding: `${space.xs} 4px`,
	border: `1px solid ${vars.color.accent}`,
	borderRadius: radius.sm,
	background: vars.color.bg,
	color: vars.color.ink,
	fontSize: textSize.sm,
	outline: "none",
});

export const closeBtn = style({
	width: 18,
	height: 18,
	border: "none",
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.color.inkMuted,
	fontSize: textSize.base,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 0,
	lineHeight: 1,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised, color: vars.color.danger },
		"&:disabled": { opacity: 0.25, cursor: "not-allowed" },
	},
});

export const addBtn = style({
	width: 28,
	height: 28,
	border: "none",
	borderRadius: radius.sm,
	background: "transparent",
	color: vars.color.inkMuted,
	fontSize: textSize.lg,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	marginLeft: 4,
	flexShrink: 0,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised },
	},
});

export const editor = style({
	flex: 1,
	border: "none",
	outline: "none",
	resize: "none",
	padding: `${space.xl} 24px`,
	fontSize: textSize.base,
	lineHeight: 1.7,
	fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace',
	background: vars.color.bg,
	color: vars.color.ink,
	selectors: {
		"&::placeholder": { color: vars.color.inkMuted },
	},
});
