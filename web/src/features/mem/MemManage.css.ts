/**
 * MemManage — 页面布局（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export { btnGhost as backLink, btnPrimary as addLink } from "@styles/base.css.ts";

export const page = style({
	display: "flex",
	flexDirection: "column",
	height: "100vh",
	background: vars.v2.bg,
	color: vars.v2.ink,
});

export const topBar = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	padding: `${space.sm} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
	flexShrink: 0,
	"@media": {
		"(max-width: 768px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const title = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.lg,
	fontWeight: 600,
	letterSpacing: "0.08em",
	margin: 0,
	color: vars.v2.ink,
	flex: 1,
});

export const topActions = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
});

export const count = style({
	fontSize: 11,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	fontVariantNumeric: "tabular-nums",
});

export const split = style({
	flex: 1,
	display: "flex",
	minHeight: 0,
	overflow: "hidden",
});

export const tableWrap = style({
	flex: 1,
	minWidth: 0,
	display: "flex",
	flexDirection: "column",
	padding: `${space.md} 20px`,
	overflowY: "auto",
	"@media": {
		"(max-width: 768px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

// 详情侧栏激活态标记（空类，供 classList 组合）
export const detailActive = style({});
