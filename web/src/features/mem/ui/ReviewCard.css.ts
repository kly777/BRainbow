/**
 * ReviewCard — 复习卡片（vanilla-extract 迁移）
 * 按钮复用 base.css.ts 通用件
 */
import { keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

// 按钮复用 base（组件引用 styles.ghostBtn/primaryBtn/navBtn）
export { btnGhost as ghostBtn, btnNav as navBtn, btnPrimary as primaryBtn } from "@styles/base.css.ts";

export const cardWrap = style({
	width: "100%",
	maxWidth: 680,
	marginBottom: 96,
});

export const previewBanner = style({
	padding: `${space.xs} ${space.md}`,
	marginBottom: space.md,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
	borderRadius: radius.md,
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
});

export const cardStage = style({
	position: "relative",
});

export const card = style({
	width: "100%",
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.lg,
	boxShadow: "0 2px 10px rgb(0 0 0 / 5%)",
	overflow: "hidden",
});

export const face = style({
	display: "flex",
	flexDirection: "column",
});

const answerIn = keyframes({
	from: { opacity: 0, transform: "translateY(-8px)" },
	to: { opacity: 1, transform: "translateY(0)" },
});

export const answer = style({
	display: "flex",
	flexDirection: "column",
	borderTop: `1px solid ${vars.v2.border}`,
	animation: `${answerIn} 0.3s ease`,
	"@media": {
		"(prefers-reduced-motion: reduce)": { animation: "none" },
	},
});

export const cardTab = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	gap: space.sm,
	padding: `${space.sm} ${space.md}`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const cardTabText = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.ink,
});

export const cardTabNo = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	fontVariantNumeric: "tabular-nums",
});

export const cardBody = style({
	flex: 1,
	padding: `${space.lg} ${space.xl}`,
	overflow: "visible",
	display: "flex",
	flexDirection: "column",
	"@media": {
		"(max-width: 600px)": { padding: space.md },
	},
});

export const content = style({
	fontSize: textSize.base,
	lineHeight: 1.75,
	color: vars.v2.ink,
	wordBreak: "break-word",
});

export const cardTools = style({
	display: "flex",
	alignItems: "center",
	gap: "2px",
	padding: `${space.xs} ${space.md}`,
	borderTop: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const toolBtn = style({
	border: "none",
	background: "none",
	cursor: "pointer",
	padding: "4px 6px",
	fontSize: 13,
	lineHeight: 1,
	opacity: 0.55,
	transition: "opacity 0.15s",
	borderRadius: 4,
	selectors: {
		"&:hover:not(:disabled)": {
			opacity: 1,
			background: vars.v2.surfaceRaised,
		},
		"&:disabled": { opacity: 0.2, cursor: "default" },
	},
});

export const mnemonic = style({
	marginTop: space.md,
	padding: "12px 16px",
	background: vars.v2.badgeReviewBg,
	border: `1px solid ${vars.v2.badgeReviewText}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
});

export const mnemonicLabel = style({
	fontWeight: 600,
	marginBottom: 4,
	fontSize: 12,
	color: vars.v2.badgeReviewText,
});

export const mnemonicLoading = style({
	color: vars.v2.inkFaint,
});

export const banner = style({
	padding: `${space.sm} ${space.md}`,
	marginBottom: space.md,
	background: vars.v2.badgeLearningBg,
	color: vars.v2.badgeLearningText,
	borderRadius: radius.md,
	fontSize: textSize.sm,
});

export const cardFlat = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.lg,
	padding: space.xl,
});

export const section = style({
	marginBottom: space.sm,
});

export const sectionLabel = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.inkMuted,
	marginBottom: space.sm,
});

export const divider = style({
	height: 1,
	background: vars.v2.border,
	margin: `${space.md} 0`,
});

export const editArea = style({
	width: "100%",
	padding: space.md,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	fontFamily: vars.v2.fontMono,
	lineHeight: 1.6,
	resize: "vertical",
	background: vars.v2.bg,
	color: vars.v2.ink,
	transition: "border-color 0.15s, box-shadow 0.15s",
	boxSizing: "border-box",
	outline: "none",
	selectors: {
		"&:focus": {
			borderColor: vars.v2.accent,
			boxShadow: `0 0 0 2px ${vars.v2.accentSoft}`,
		},
	},
});

export const actionRow = style({
	position: "fixed",
	bottom: 0,
	left: "50%",
	transform: "translateX(-50%)",
	zIndex: 20,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.sm,
	padding: `${space.sm} ${space.lg}`,
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderBottom: "none",
	borderRadius: "14px 14px 0 0",
	boxShadow: "0 -4px 16px rgb(0 0 0 / 8%)",
	flexWrap: "nowrap",
	maxWidth: "100vw",
	"@media": {
		"(max-width: 600px)": {
			left: 0,
			transform: "none",
			width: "100%",
			gap: 4,
			padding: "6px 12px",
			borderRadius: 0,
			borderLeft: "none",
			borderRight: "none",
		},
	},
});

export const ratings = style({
	display: "grid",
	gridTemplateColumns: "repeat(4, 1fr)",
	gap: space.sm,
	marginTop: space.md,
	"@media": {
		"(max-width: 600px)": { gridTemplateColumns: "repeat(2, 1fr)" },
	},
});

export const ratingBtn = style({
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: 2,
	padding: "10px 8px",
	border: "1px solid transparent",
	borderRadius: radius.md,
	cursor: "pointer",
	transition: "filter 0.15s, transform 0.1s",
	selectors: {
		"&:hover": {
			filter: "brightness(0.95)",
			transform: "translateY(-1px)",
		},
	},
});

export const ratingLabel = style({
	fontSize: textSize.sm,
	fontWeight: 500,
});

export const ratingTime = style({
	fontSize: 11,
	fontFamily: vars.v2.fontMono,
	opacity: 0.8,
});

export const again = style({
	background: vars.v2.badgeRelearningBg,
	color: vars.v2.badgeRelearningText,
});

export const hard = style({
	background: vars.v2.badgeLearningBg,
	color: vars.v2.badgeLearningText,
});

export const good = style({
	background: vars.v2.badgeReviewBg,
	color: vars.v2.badgeReviewText,
});

export const easy = style({
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
});

export const empty = style({
	textAlign: "center",
	padding: `${space.xl} 0`,
	color: vars.v2.inkFaint,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: space.sm,
});

export const emptyTitle = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.lg,
	color: vars.v2.ink,
});

export const emptyHint = style({
	fontSize: textSize.sm,
});
