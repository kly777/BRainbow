/**
 * Modal — 通用弹窗（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const modalOverlay = style({
	position: "fixed",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0,
	backgroundColor: "oklch(0 0 0 / 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 1000,
	padding: space.xl,
});

export const modalContent = style({
	backgroundColor: vars.color.surface,
	borderRadius: radius.md,
	border: `1px solid ${vars.color.border}`,
	boxShadow: `0 ${space.xs} 20px oklch(0 0 0 / 0.15)`,
	maxWidth: 600,
	width: "100%",
	maxHeight: "90vh",
	display: "flex",
	flexDirection: "column",
	overflow: "hidden",
});

export const modalHeader = style({
	padding: space.xl,
	borderBottom: `1px solid ${vars.color.border}`,
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
});

export const modalTitle = style({
	margin: 0,
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.color.ink,
});

export const modalClose = style({
	background: "none",
	border: "none",
	fontSize: textSize.xl,
	lineHeight: 1,
	color: vars.color.inkMuted,
	cursor: "pointer",
	padding: 0,
	width: 30,
	height: 30,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: radius.sm,
	transition: "background-color 0.2s, color 0.2s",
	selectors: {
		"&:hover": { backgroundColor: vars.color.surfaceRaised, color: vars.color.ink },
	},
});

export const modalBody = style({
	padding: space.xl,
	flex: 1,
	overflowY: "auto",
});

export const modalFooter = style({
	padding: space.xl,
	borderTop: `1px solid ${vars.color.border}`,
	display: "flex",
	justifyContent: "flex-end",
	gap: space.sm,
});

export const modalBodyContent = style({
	display: "flex",
	flexDirection: "column",
	gap: space.md,
});

export const formGroup = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
});

export const formLabel = style({
	fontWeight: 500,
	color: vars.color.inkMuted,
	fontSize: textSize.base,
});

export const taskSelector = style({
	width: "100%",
	padding: space.sm,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	fontSize: textSize.base,
	backgroundColor: vars.color.surface,
	selectors: {
		"&:focus": {
			outline: "none",
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 3px ${vars.color.accentSoft}`,
		},
	},
});

export const taskOption = style({
	padding: `${space.sm} 12px`,
});

export const infoBox = style({
	backgroundColor: vars.color.surface,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.sm,
	padding: space.md,
	marginTop: 15,
});

globalStyle(`${infoBox} p`, {
	marginBottom: space.sm,
	fontWeight: 500,
});

globalStyle(`${infoBox} ul`, {
	margin: 0,
	paddingLeft: 20,
	color: vars.color.inkMuted,
});

globalStyle(`${infoBox} li`, {
	marginBottom: 4,
});

export const emptyList = style({
	textAlign: "center",
	padding: space.xl,
	color: vars.color.inkMuted,
});

globalStyle(`${emptyList} p`, {
	marginBottom: space.sm,
});

export const loading = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: space.xl,
	color: vars.color.inkMuted,
});

const spin = keyframes({
	to: { transform: "rotate(360deg)" },
});

export const loadingAfter = style({
	content: '""',
	width: 20,
	height: 20,
	border: `2px solid ${vars.color.border}`,
	borderTopColor: vars.color.accent,
	borderRadius: "50%",
	marginLeft: 10,
	animation: `${spin} 1s linear infinite`,
});

export const errorMessage = style({
	backgroundColor: vars.color.dangerSubtle,
	color: "oklch(0.3 0.07 28)",
	padding: space.sm,
	borderRadius: radius.sm,
	border: "1px solid oklch(0.88 0.04 28)",
});

export const successMessage = style({
	backgroundColor: vars.color.successSubtle,
	color: "oklch(0.3 0.07 160)",
	padding: space.sm,
	borderRadius: radius.sm,
	border: `1px solid ${vars.color.successSubtle}`,
});
