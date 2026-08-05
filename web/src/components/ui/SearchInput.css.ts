/**
 * SearchInput — 搜索输入（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const input = style({
	padding: `${space.xs} ${space.sm}`,
	fontSize: textSize.sm,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: vars.color.bg,
	color: vars.color.ink,
	outline: "none",
	transition: "border-color 0.15s",
	selectors: {
		"&:focus": { borderColor: vars.color.accent },
		"&::placeholder": { color: vars.color.inkMuted },
	},
});
