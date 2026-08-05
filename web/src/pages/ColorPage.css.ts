/**
 * ColorPage — 主题切换页样式
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const page = style({
	maxWidth: 760,
	margin: "0 auto",
	padding: space.xl,
});

export const title = style({
	fontFamily: vars.font.display,
	fontSize: textSize.xl,
	color: vars.color.ink,
	margin: `0 0 ${space.sm}`,
});

export const desc = style({
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	margin: `0 0 ${space.xl}`,
	lineHeight: 1.7,
});

export const grid = style({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
	gap: space.lg,
});

export const card = style({
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.lg,
	padding: space.lg,
	cursor: "pointer",
	transition: "transform 0.15s, box-shadow 0.15s, border-color 0.15s",
	selectors: {
		"&:hover": {
			transform: "translateY(-2px)",
			boxShadow: `0 4px 16px ${vars.color.accentSoft}`,
		},
	},
});

export const cardActive = style({
	borderColor: vars.color.accent,
	boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
});

export const swatchRow = style({
	display: "flex",
	gap: space.xs,
	marginBottom: space.md,
});

export const swatch = style({
	width: 44,
	height: 44,
	borderRadius: radius.md,
	border: `1px solid ${vars.color.border}`,
});

export const cardName = style({
	fontFamily: vars.font.display,
	fontSize: textSize.base,
	fontWeight: 600,
	color: vars.color.ink,
	marginBottom: 4,
});

export const cardStatus = style({
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	color: vars.color.accent,
	minHeight: 16,
});

export const previewBox = style({
	marginTop: space.md,
	padding: space.sm,
	borderRadius: radius.md,
	border: `1px solid ${vars.color.borderStrong}`,
	display: "flex",
	gap: space.xs,
});

export const previewBtn = style({
	fontSize: textSize.xs,
	padding: `${space.xs} 10px`,
	borderRadius: radius.sm,
	border: "none",
	cursor: "default",
});

export const previewAccent = style({
	background: vars.color.accent,
	color: vars.color.white,
});

export const previewMuted = style({
	background: "transparent",
	color: vars.color.inkMuted,
	border: `1px solid ${vars.color.borderStrong}`,
});

export const previewPlain = style({
	background: vars.color.surfaceRaised,
	color: vars.color.inkMuted,
});

export const footer = style({
	marginTop: space.xl,
	display: "flex",
	gap: space.sm,
	alignItems: "center",
});

export const footerHint = style({
	fontSize: textSize.xs,
	color: vars.color.inkFaint,
	alignSelf: "center",
});
