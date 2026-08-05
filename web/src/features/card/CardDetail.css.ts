/**
 * CardDetail — 卡片详情（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { space, textSize, vars } from "@styles/tokens.css.ts";

export const container = style({
	maxWidth: 1440,
	margin: "0 auto",
	height: "100%",
	display: "flex",
	flexDirection: "column",
});

export const content = style({
	flex: 1,
	padding: `${space.lg} 24px`,
	overflowY: "auto",
});

export const meta = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	marginBottom: space.xl,
});

export const body = style({
	fontSize: textSize.base,
	lineHeight: 1.8,
});
