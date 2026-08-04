/**
 * CardsList — 卡片列表页（vanilla-extract 迁移）
 */
import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

export const container = style({
	width: "100%",
	height: "100dvh",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
	padding: space.xl,
	background: vars.v2.bg,
	"@media": {
		"(max-width: 768px)": { margin: "0 auto", padding: `${space.lg} 12px` },
	},
});

export const header = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	paddingBottom: 16,
	"@media": {
		"(max-width: 768px)": { alignItems: "center", gap: space.lg },
	},
});

export const title = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: "1.5rem",
	fontWeight: 600,
	letterSpacing: "0.08em",
	color: vars.v2.ink,
	margin: 0,
});

export const actions = style({
	display: "flex",
	gap: space.md,
	"@media": {
		"(max-width: 768px)": { justifyContent: "flex-end" },
	},
});

export const loading = style({
	textAlign: "center",
	padding: `${space.xl} ${space.xl}`,
	background: vars.v2.surface,
	borderRadius: radius.md,
	border: `1px solid ${vars.v2.border}`,
	margin: `${space.xl} 0`,
});

globalStyle(`${loading} p`, {
	fontSize: "1rem",
	color: vars.v2.inkMuted,
	margin: 0,
});

export const error = style({
	textAlign: "center",
	padding: `${space.xl} 20px`,
	background: vars.v2.dangerSubtle,
	border: `1px solid ${vars.v2.danger}`,
	borderRadius: radius.md,
	margin: `${space.xl} 0`,
});

globalStyle(`${error} p`, {
	fontSize: "1rem",
	color: vars.v2.danger,
	marginBottom: space.lg,
});

export const modalOverlay = style({
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	background: "oklch(0 0 0 / 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 1000,
	padding: space.xl,
});

const modalSlideIn = keyframes({
	from: { opacity: 0, transform: "translateY(-20px)" },
	to: { opacity: 1, transform: "translateY(0)" },
});

export const modal = style({
	background: vars.v2.surface,
	borderRadius: radius.lg,
	width: "100%",
	maxWidth: 500,
	maxHeight: "90vh",
	overflowY: "auto",
	boxShadow: `0 ${space.xs} 24px oklch(0 0 0 / 0.15)`,
	animation: `${modalSlideIn} 0.3s ease`,
	"@media": {
		"(max-width: 768px)": { maxWidth: "100%" },
	},
});

export const modalHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	padding: `${space.xl} 24px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	"@media": {
		"(max-width: 768px)": { padding: `${space.lg} 20px` },
	},
});

globalStyle(`${modalHeader} h2`, {
	fontSize: "1.25rem",
	fontWeight: 600,
	color: vars.v2.ink,
	margin: 0,
});

export const modalContent = style({
	padding: space.xl,
	"@media": {
		"(max-width: 768px)": { padding: space.xl },
	},
});

export const errorMessage = style({
	padding: `${space.md} 16px`,
	background: vars.v2.dangerSubtle,
	border: `1px solid ${vars.v2.danger}`,
	borderRadius: radius.sm,
	color: vars.v2.danger,
	fontSize: "0.875rem",
	marginBottom: space.xl,
});

export const formGroup = style({
	marginBottom: space.xl,
});

export const formLabel = style({
	display: "block",
	fontSize: "0.875rem",
	fontWeight: 500,
	color: vars.v2.ink,
	marginBottom: space.sm,
	selectors: {
		"&::after": { content: '" *"', color: vars.v2.danger },
	},
});

export const formInput = style({
	width: "100%",
	padding: `${space.sm} 12px`,
	fontSize: "0.875rem",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	transition: "all 0.2s ease",
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 3px ${vars.v2.accentSoft}`,
		},
		"&:disabled": { background: vars.v2.surfaceRaised, cursor: "not-allowed" },
	},
});

export const formTextarea = style({
	width: "100%",
	padding: `${space.sm} 12px`,
	fontSize: "0.875rem",
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	resize: "vertical",
	transition: "all 0.2s ease",
	fontFamily: "inherit",
	lineHeight: 1.5,
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 3px ${vars.v2.accentSoft}`,
		},
		"&:disabled": { background: vars.v2.surfaceRaised, cursor: "not-allowed" },
	},
});

export const previewSection = style({
	marginTop: space.md,
	padding: space.md,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.sm,
	background: vars.v2.bg,
});

export const previewLabel = style({
	display: "block",
	fontSize: "0.75rem",
	color: vars.v2.inkFaint,
	marginBottom: space.xs,
	textTransform: "uppercase",
	letterSpacing: 0.5,
});

export const previewContent = style({
	fontSize: "0.875rem",
	lineHeight: 1.6,
	color: vars.v2.ink,
});

globalStyle(`${previewContent} p`, {
	margin: `0 0 ${space.sm}`,
});

globalStyle(`${previewContent} p:last-child`, {
	marginBottom: 0,
});

export const state = style({
	flex: 1,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	justifyContent: "center",
	padding: `${space.xl} 16px`,
	textAlign: "center",
	color: vars.v2.inkMuted,
	fontSize: textSize.base,
});

export const errorText = style({
	color: vars.v2.danger,
	marginBottom: 10,
});

export const modalActions = style({
	display: "flex",
	justifyContent: "flex-end",
	gap: space.md,
	padding: `${space.xl} 24px`,
	borderTop: `1px solid ${vars.v2.border}`,
	"@media": {
		"(max-width: 768px)": { padding: `${space.lg} 20px` },
		"(max-width: 480px)": { flexDirection: "column" },
	},
});
