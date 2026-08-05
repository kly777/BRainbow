/**
 * HomePage — 主页仪表盘（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const homePage = style({
	margin: "0 auto",
	padding: `${space.xl} 20px`,
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
	maxWidth: 1440,
	"@media": {
		"(max-width: 768px)": { padding: `${space.lg} 12px` },
	},
});

export const moduleNav = style({
	display: "flex",
	gap: space.sm,
	marginBottom: space.xl,
	flexShrink: 0,
	flexWrap: "wrap",
});

export const moduleCard = style({
	padding: `${space.xs} 16px`,
	borderRadius: radius.md,
	background: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	textDecoration: "none",
	fontSize: textSize.base,
	fontWeight: 500,
	color: vars.color.inkMuted,
	transition: "background 0.15s, color 0.15s",
	selectors: {
		"&:hover": {
			background: vars.color.accentSoft,
			color: vars.color.accent,
			borderColor: vars.color.accent,
			textDecoration: "none",
		},
	},
});

export const moduleIcon = style({ display: "none" });
export const moduleLabel = style({ display: "none" });
export const moduleDesc = style({ display: "none" });

export const mainContent = style({
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	gap: space.xl,
	flex: 1,
	minHeight: 0,
	"@media": {
		"(max-width: 1024px)": { gridTemplateColumns: "1fr" },
	},
});

export const dashboardSection = style({
	background: vars.color.surface,
	borderRadius: radius.lg,
	padding: space.xl,
	boxShadow: "0 1px 3px oklch(0 0 0 / 0.08)",
	border: `1px solid ${vars.color.border}`,
	display: "flex",
	flexDirection: "column",
	minHeight: 0,
	overflow: "hidden",
	"@media": {
		"(max-width: 768px)": { padding: space.lg },
	},
});

export const sectionHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: space.lg,
	paddingBottom: 12,
	borderBottom: `2px solid ${vars.color.border}`,
	flexShrink: 0,
	"@media": {
		"(max-width: 768px)": {
			flexDirection: "column",
			alignItems: "flex-start",
			gap: space.sm,
		},
	},
});

export const sectionTitle = style({
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.color.ink,
	margin: 0,
});

export const sectionActions = style({
	display: "flex",
	gap: space.md,
	alignItems: "center",
	"@media": {
		"(max-width: 768px)": { width: "100%", justifyContent: "space-between" },
	},
});

export const viewAllLink = style({
	color: vars.color.accent,
	textDecoration: "none",
	fontSize: textSize.sm,
	fontWeight: 500,
	padding: `${space.xs} 10px`,
	borderRadius: radius.md,
	transition: "all 0.2s ease",
	selectors: {
		"&:hover": { backgroundColor: vars.color.accentSoft },
	},
});

export const createLink = style({
	backgroundColor: vars.color.accent,
	color: vars.color.white,
	textDecoration: "none",
	fontSize: textSize.sm,
	fontWeight: 500,
	padding: `${space.xs} 14px`,
	borderRadius: radius.md,
	transition: "background-color 0.2s ease",
	selectors: {
		"&:hover": { backgroundColor: vars.color.accentStrong },
	},
});

export const emptyState = style({
	textAlign: "center",
	padding: `${space.xl} 20px`,
	color: vars.color.inkMuted,
});

globalStyle(`${emptyState} p`, {
	fontSize: textSize.base,
	margin: `0 0 ${space.sm} 0`,
});

export const emptyHint = style({
	fontSize: textSize.sm,
	opacity: 0.7,
});

globalStyle(`${emptyHint} a`, {
	color: vars.color.accent,
});
