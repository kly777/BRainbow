/**
 * LandingPage — 落地页（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const landingPage = style({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	minHeight: "calc(100vh - 80px)",
	padding: space.xl,
	textAlign: "center",
});

export const heroTitle = style({
	fontSize: textSize.xl,
	fontWeight: 700,
	color: vars.color.ink,
	margin: `0 0 ${space.lg} 0`,
	letterSpacing: -0.5,
	"@media": {
		"(max-width: 640px)": { fontSize: textSize.xl },
	},
});

export const heroSubtitle = style({
	fontSize: textSize.lg,
	color: vars.color.inkMuted,
	margin: `0 0 ${space.xl} 0`,
	maxWidth: 480,
	lineHeight: 1.7,
	"@media": {
		"(max-width: 640px)": { fontSize: textSize.base },
	},
});

export const ctaRow = style({
	display: "flex",
	alignItems: "center",
	gap: space.lg,
	marginBottom: 48,
	flexWrap: "wrap",
	justifyContent: "center",
});

export const ctaPrimary = style({
	padding: `${space.md} 32px`,
	background: vars.color.accent,
	color: vars.color.white,
	border: "none",
	borderRadius: radius.md,
	fontSize: textSize.lg,
	fontWeight: 600,
	cursor: "pointer",
	transition: "background 0.2s",
	fontFamily: "inherit",
	selectors: {
		"&:hover": { background: vars.color.accentStrong },
	},
});

export const ctaDivider = style({
	color: vars.color.inkMuted,
	fontSize: textSize.base,
});

export const ctaSecondary = style({
	padding: `${space.sm} 24px`,
	background: "transparent",
	color: vars.color.accent,
	border: `2px solid ${vars.color.accent}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	fontWeight: 500,
	cursor: "pointer",
	transition: "background 0.2s, color 0.2s",
	fontFamily: "inherit",
	selectors: {
		"&:hover": { background: vars.color.accent, color: vars.color.white },
	},
});

export const featureGrid = style({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
	gap: space.lg,
	width: "100%",
	maxWidth: 800,
	marginBottom: 40,
	"@media": {
		"(max-width: 640px)": {
			gridTemplateColumns: "1fr 1fr",
			gap: space.md,
		},
	},
});

export const featureCard = style({
	background: vars.color.surface,
	borderRadius: radius.lg,
	padding: `${space.xl} 20px`,
	boxShadow: "0 1px 3px oklch(0 0 0 / 0.08)",
	border: `1px solid ${vars.color.border}`,
	transition: "transform 0.2s, box-shadow 0.2s",
	textDecoration: "none",
	color: "inherit",
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	textAlign: "center",
	selectors: {
		"&:hover": {
			transform: "translateY(-3px)",
			boxShadow: "0 8px 24px oklch(0 0 0 / 0.12)",
			textDecoration: "none",
		},
	},
});

export const featureIcon = style({
	fontSize: textSize.xl,
	marginBottom: space.md,
});

globalStyle(`${featureCard} h3`, {
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.color.ink,
	margin: `0 0 ${space.sm} 0`,
});

globalStyle(`${featureCard} p`, {
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	margin: 0,
	lineHeight: 1.5,
});

export const hint = style({
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
	margin: 0,
	lineHeight: 1.8,
});

globalStyle(`${hint} kbd`, {
	display: "inline-block",
	padding: `${space.xs} 7px`,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	background: vars.color.surfaceRaised,
	fontFamily: "monospace",
	fontSize: textSize.sm,
	color: vars.color.inkMuted,
});
