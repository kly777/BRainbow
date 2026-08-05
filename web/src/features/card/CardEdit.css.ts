/**
 * CardEdit — 编辑卡片（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const container = style({
	maxWidth: 1440,
	margin: "0 auto",
	height: "100%",
	display: "flex",
	flexDirection: "column",
});

export const errorMsg = style({
	padding: `${space.sm} 16px`,
	background: vars.v2.dangerSubtle,
	color: vars.v2.danger,
	fontSize: textSize.sm,
	borderBottom: `1px solid ${vars.v2.danger}`,
});
