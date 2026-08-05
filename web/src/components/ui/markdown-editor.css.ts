/**
 * MarkdownEditor — 富文本编辑器（vanilla-extract 迁移）
 */
import { composeStyles, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const editor = style({
	display: "flex",
	flexDirection: "column",
	gap: 0,
});

export const textarea = style({
	width: "100%",
	padding: space.md,
	border: `2px solid ${vars.color.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	fontFamily:
		"ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	lineHeight: 1.6,
	resize: "vertical",
	background: vars.color.surface,
	color: vars.color.ink,
	transition: "border-color 0.15s",
	boxSizing: "border-box",
	selectors: {
		"&:focus": { outline: "none", borderColor: vars.color.accent },
	},
});

export const textareaDrag = composeStyles(
	textarea,
	style({
		borderColor: vars.color.accent,
		background: vars.color.accentSoft,
	}),
);

export const preview = style({
	marginTop: space.sm,
	padding: space.md,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: vars.color.surface,
	minHeight: 40,
});
