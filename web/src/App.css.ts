/**
 * App — 应用壳 + 落地页（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const shell = style({
	display: "flex",
	flexDirection: "column",
	minHeight: "100vh",
	background: vars.v2.bg,
});

export const content = style({
	flex: 1,
	minWidth: 0,
	minHeight: 0,
});

export const footer = style({
	textAlign: "center",
	padding: space.md,
	marginTop: 15,
	color: vars.v2.inkMuted,
	fontSize: textSize.sm,
	borderTop: `1px solid ${vars.v2.border}`,
});

export const landingPage = style({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	height: "100%",
	padding: `${space.xl} 20px`,
	textAlign: "center",
	"@media": {
		"(max-width: 768px)": { padding: `${space.xl} ${space.md}` },
		"(max-width: 480px)": { padding: `${space.xl} 10px` },
	},
});

globalStyle(`${landingPage} h1`, {
	fontSize: textSize.xl,
	marginBottom: space.xl,
	color: vars.v2.ink,
});

globalStyle(`${landingPage} p`, {
	fontSize: textSize.lg,
	color: vars.v2.inkMuted,
	marginBottom: 40,
	maxWidth: 600,
	lineHeight: 1.6,
});

export const landingLink = style({
	color: vars.v2.accent,
	textDecoration: "none",
	fontWeight: 500,
	padding: `${space.sm} 20px`,
	border: `2px solid ${vars.v2.accent}`,
	borderRadius: radius.md,
	transition: "all 0.3s ease",
	selectors: {
		"&:hover": {
			backgroundColor: vars.v2.accent,
			color: vars.v2.bg,
			textDecoration: "none",
		},
	},
});

export const featureGrid = style({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
	gap: space.xl,
	margin: `${space.xl} 0`,
	width: "100%",
	maxWidth: 900,
	"@media": {
		"(max-width: 768px)": {
			gridTemplateColumns: "1fr",
			gap: space.md,
		},
	},
});

export const featureCard = style({
	backgroundColor: vars.v2.surface,
	borderRadius: radius.md,
	padding: space.xl,
	boxShadow: "0 3px 10px oklch(0 0 0 / 0.08)",
	transition: "transform 0.3s ease, box-shadow 0.3s ease",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	selectors: {
		"&:hover": {
			transform: "translateY(-5px)",
			boxShadow: "0 8px 24px oklch(0 0 0 / 0.12)",
		},
	},
	"@media": {
		"(max-width: 768px)": { padding: space.lg },
		"(max-width: 480px)": { padding: space.md },
	},
});

globalStyle(`${featureCard} h3`, {
	fontSize: textSize.xl,
	margin: `0 0 ${space.md} 0`,
	color: vars.v2.ink,
	display: "flex",
	alignItems: "center",
	gap: space.sm,
});

globalStyle(`${featureCard} p`, {
	fontSize: textSize.base,
	color: vars.v2.inkMuted,
	marginBottom: space.xl,
	lineHeight: 1.5,
	flex: 1,
});

export const featureLink = style({
	display: "inline-block",
	backgroundColor: vars.v2.accent,
	color: vars.v2.bg,
	padding: `${space.sm} 20px`,
	borderRadius: radius.md,
	textDecoration: "none",
	fontWeight: 500,
	transition: "background-color 0.3s ease",
	border: "none",
	selectors: {
		"&:hover": {
			backgroundColor: vars.v2.accentStrong,
			color: vars.v2.bg,
			textDecoration: "none",
		},
	},
});

export const quickStats = style({
	marginTop: 30,
	padding: space.md,
	backgroundColor: vars.v2.bg,
	borderRadius: radius.md,
	maxWidth: 700,
	"@media": {
		"(max-width: 480px)": { padding: space.md },
	},
});

globalStyle(`${quickStats} p`, {
	fontSize: textSize.lg,
	color: vars.v2.inkMuted,
	margin: `${space.sm} 0`,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.sm,
	"@media": {
		"(max-width: 768px)": {
			fontSize: textSize.base,
			flexDirection: "column",
			gap: space.xs,
		},
	},
});
