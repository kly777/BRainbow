/**
 * CardAdd — 添加卡片（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const container = style({
	maxWidth: 1440,
	margin: "0 auto",
	height: "100%",
	display: "flex",
	flexDirection: "column",
});

export const errorMsg = style({
	padding: `${space.sm} 16px`,
	background: vars.color.dangerSubtle,
	color: vars.color.danger,
	fontSize: textSize.sm,
	borderBottom: `1px solid ${vars.color.danger}`,
});

export const editorArea = style({
	flex: 1,
	display: "flex",
	minHeight: 0,
});
