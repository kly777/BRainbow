/**
 * SearchInput — 搜索输入（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const input = style({
	padding: `${space.xs} ${space.sm}`,
	fontSize: textSize.sm,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	background: vars.v2.bg,
	color: vars.v2.ink,
	outline: "none",
	transition: "border-color 0.15s",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent },
		"&::placeholder": { color: vars.v2.inkMuted },
	},
});
