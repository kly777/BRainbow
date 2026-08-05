/**
 * CommandPalette — 命令面板（vanilla-extract 迁移，目录卡风格）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const overlay = style({
	position: "fixed",
	inset: 0,
	zIndex: 90,
	background: "oklch(0 0 0 / 0.45)",
	display: "flex",
	justifyContent: "center",
	backdropFilter: "blur(2px)",
	selectors: {
		"&:focus-visible": { outline: "none" },
	},
});

export const bar = style({
	position: "fixed",
	top: 80,
	left: "50%",
	transform: "translateX(-50%)",
	zIndex: 99,
	display: "flex",
	flexDirection: "column",
	width: "var(--cmp-width, 480px)",
	maxWidth: "90vw",
	maxHeight: "60vh",
	overflowWrap: "break-word",
});

export const inputRow = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: `${space.sm} 16px`,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.lg,
	background: vars.v2.surface,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.14)",
	transition: "border-color 0.15s, box-shadow 0.15s",
	selectors: {
		"&:focus-within": {
			borderColor: vars.v2.accent,
			boxShadow: `0 8px 32px oklch(0 0 0 / 0.14), 0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const prefix = style({
	fontSize: textSize.lg,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.accent,
	fontWeight: 600,
	minWidth: 14,
	textAlign: "center",
});

export const input = style({
	flex: 1,
	border: "none",
	outline: "none",
	background: "transparent",
	fontSize: textSize.base,
	color: vars.v2.ink,
	caretColor: vars.v2.accent,
	fontFamily: "inherit",
	selectors: {
		"&:focus-visible": {
			outline: "none",
			boxShadow: "none",
			borderColor: "transparent",
		},
		"&::placeholder": { color: vars.v2.inkFaint },
	},
});

export const suggestions = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.12)",
	marginTop: 6,
	maxHeight: 280,
	overflowY: "auto",
	padding: space.xs,
});

export const suggestionItem = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	padding: `${space.sm} 12px`,
	border: "none",
	borderRadius: radius.md,
	background: "transparent",
	cursor: "pointer",
	font: "inherit",
	width: "100%",
	textAlign: "left",
	color: "inherit",
	transition: "background 0.1s",
	position: "relative",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised },
		"&:focus-visible": { outline: "none", background: vars.v2.surfaceRaised },
		"&:hover::before, &:focus-visible::before": {
			content: '""',
			position: "absolute",
			left: 0,
			top: "20%",
			bottom: "20%",
			width: 3,
			borderRadius: 2,
			background: vars.v2.accent,
		},
	},
});

export const sugLabel = style({
	fontSize: textSize.base,
	fontWeight: 600,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.ink,
	minWidth: 60,
});

export const sugDesc = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	flex: 1,
});

export const sugPath = style({
	fontSize: textSize.sm,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
});

export const empty = style({
	padding: `${space.md} 16px`,
	textAlign: "center",
	fontSize: textSize.sm,
	color: vars.v2.inkFaint,
});

export const searchHint = style({
	padding: `${space.sm} 16px`,
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
});

globalStyle(`${searchHint} kbd`, {
	display: "inline-block",
	padding: "1px 6px",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: 4,
	background: vars.v2.bg,
	fontFamily: vars.v2.fontMono,
	fontSize: textSize.xs,
	color: vars.v2.ink,
});

export const fab = style({
	display: "none",
	"@media": {
		"(max-width: 768px)": {
			display: "flex",
			alignItems: "center",
			justifyContent: "center",
			position: "fixed",
			bottom: 20,
			right: 20,
			zIndex: 70,
			width: 48,
			height: 48,
			border: "none",
			borderRadius: "50%",
			background: vars.v2.accent,
			color: vars.v2.white,
			fontSize: 22,
			boxShadow: `0 2px 12px ${vars.v2.accentSoft}`,
			cursor: "pointer",
			transition: "transform 0.15s",
			selectors: {
				"&:hover": { transform: "scale(1.08)" },
				"&:active": { transform: "scale(0.95)" },
			},
		},
	},
});
