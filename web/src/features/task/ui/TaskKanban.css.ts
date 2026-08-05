/**
 * TaskKanban — 看板（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const board = style({
	display: "grid",
	gridTemplateColumns: "repeat(3, 1fr)",
	gap: space.lg,
	flex: 1,
	minHeight: 0,
	overflowY: "auto",
	"@media": {
		"(max-width: 900px)": {
			gridTemplateColumns: "1fr",
			height: "auto",
		},
	},
});

export const column = style({
	background: vars.v2.surfaceRaised,
	borderRadius: radius.lg,
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	border: "none",
	borderTop: "3px solid var(--col-color, var(--v2-border))",
	padding: 0,
	margin: 0,
	minWidth: 0,
	transition: "box-shadow 0.2s",
});

export const columnHeader = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: `${space.md} 16px 10px`,
	flexShrink: 0,
});

export const columnIcon = style({
	fontSize: textSize.lg,
});

export const columnLabel = style({
	fontSize: textSize.base,
	fontWeight: 600,
	color: vars.v2.ink,
	flex: 1,
});

export const columnCount = style({
	fontSize: textSize.sm,
	fontWeight: 700,
	background: vars.v2.border,
	color: vars.v2.inkMuted,
	padding: `${space.xs} 10px`,
	borderRadius: radius.lg,
	minWidth: 24,
	textAlign: "center",
});

export const columnBody = style({
	flex: 1,
	overflowY: "auto",
	padding: `0 ${space.md} ${space.md}`,
	display: "flex",
	flexDirection: "column",
	gap: space.sm,
	"@media": {
		"(max-width: 900px)": { maxHeight: 300 },
	},
});

export const emptyCol = style({
	textAlign: "center",
	color: vars.v2.inkMuted,
	fontSize: textSize.sm,
	padding: `${space.xl} 16px`,
	border: `2px dashed ${vars.v2.border}`,
	borderRadius: radius.md,
});

export const card = style({
	display: "block",
	width: "100%",
	font: "inherit",
	textAlign: "inherit",
	background: vars.v2.surface,
	borderRadius: radius.md,
	padding: space.md,
	boxShadow: "0 1px 2px oklch(0 0 0 / 0.06)",
	cursor: "grab",
	transition: "transform 0.12s, box-shadow 0.12s",
	border: `1px solid ${vars.v2.border}`,
	selectors: {
		"&:active": { cursor: "grabbing" },
		"&:hover": {
			transform: "translateY(-1px)",
			boxShadow: "0 2px 6px oklch(0 0 0 / 0.1)",
		},
	},
});

export const cardTitle = style({
	display: "flex",
	alignItems: "flex-start",
	gap: space.xs,
	marginBottom: 4,
});

export const subBadge = style({
	fontSize: textSize.xs,
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
	padding: space.xs,
	borderRadius: radius.sm,
	fontWeight: 600,
	flexShrink: 0,
	lineHeight: 1.5,
});

export const cardTitleText = style({
	fontSize: textSize.sm,
	fontWeight: 600,
	color: vars.v2.ink,
	lineHeight: 1.4,
	overflow: "hidden",
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
});

export const cardDesc = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	margin: `0 0 ${space.sm} 0`,
	lineHeight: 1.4,
	overflow: "hidden",
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
});

export const cardMeta = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
});

export const effortTag = style({
	fontSize: textSize.xs,
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
	padding: `${space.xs} 6px`,
	borderRadius: radius.sm,
	fontWeight: 500,
});

export const cardDate = style({
	fontSize: textSize.xs,
	color: vars.v2.inkMuted,
});
