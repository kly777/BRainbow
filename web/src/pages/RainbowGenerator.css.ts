/**
 * RainbowGenerator — 彩虹生成器（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const page = style({
	display: "flex",
	gap: space.xl,
	padding: space.xl,
	maxWidth: 1440,
	margin: "0 auto",
	flexWrap: "wrap",
	"@media": {
		"(max-width: 480px)": { padding: space.md, gap: space.md },
	},
});

export const controls = style({
	flex: "1 1 400px",
	minWidth: 340,
	"@media": {
		"(max-width: 480px)": { minWidth: 0, flexBasis: "100%" },
	},
});

export const preview = style({
	flex: "0 0 auto",
	maxWidth: "100%",
	overflowX: "auto",
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "center",
	padding: space.lg,
	background: vars.color.surfaceRaised,
	borderRadius: radius.lg,
	border: `1px solid ${vars.color.border}`,
});

export const exportBtns = style({
	display: "flex",
	gap: space.sm,
	marginBottom: space.lg,
});

export const renderLabel = style({
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	display: "block",
	marginBottom: space.xs,
});

export const renderMode = style({
	marginBottom: space.lg,
});

export const stats = style({
	marginTop: space.sm,
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	padding: `${space.md} 16px`,
});

globalStyle(`${stats} h3`, {
	margin: `0 0 ${space.sm} 0`,
	fontSize: textSize.base,
	color: vars.color.ink,
});

globalStyle(`${stats} table`, {
	borderCollapse: "collapse",
	width: "100%",
});

globalStyle(`${stats} td`, {
	padding: `${space.xs} ${space.sm}`,
});

globalStyle(`${stats} td:first-child`, {
	color: vars.color.inkMuted,
	whiteSpace: "nowrap",
});

globalStyle(`${stats} td:last-child`, {
	textAlign: "right",
	fontFamily: "monospace",
	color: vars.color.ink,
});
