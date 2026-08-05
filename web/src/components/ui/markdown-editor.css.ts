/**
 * MarkdownEditor — 富文本编辑器（vanilla-extract 迁移）
 */
import { composeStyles, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const editor = style({
	display: "flex",
	flexDirection: "column",
	gap: 0,
});

export const textarea = style({
	width: "100%",
	padding: space.md,
	border: `2px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	fontFamily:
		"ui-monospace, SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace",
	lineHeight: 1.6,
	resize: "vertical",
	background: vars.v2.surface,
	color: vars.v2.ink,
	transition: "border-color 0.15s",
	boxSizing: "border-box",
	selectors: {
		"&:focus": { outline: "none", borderColor: vars.v2.accent },
	},
});

export const textareaDrag = composeStyles(
	textarea,
	style({
		borderColor: vars.v2.accent,
		background: vars.v2.accentSoft,
	}),
);

export const preview = style({
	marginTop: space.sm,
	padding: space.md,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.surface,
	minHeight: 40,
});
