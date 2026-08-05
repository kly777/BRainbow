/**
 * ReviewCard — 复习卡片（vanilla-extract 迁移）
 * 按钮复用 base.css.ts 通用件
 */
import { composeStyles, globalStyle, keyframes, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

// 按钮复用 base（组件引用 styles.ghostBtn/primaryBtn/navBtn）
export { btnGhost as ghostBtn, btnNav as navBtn, btnPrimary as primaryBtn } from "@styles/base.css.ts";
import { bottomBar } from "@styles/base.css.ts";

export const cardWrap = style({
	width: "100%",
	maxWidth: 680,
	marginBottom: 96,
	display: "flex",
	flexDirection: "column",
	maxHeight: "calc(100% - 96px)",
	minHeight: 0,
});

export const previewBanner = style({
	padding: `${space.xs} ${space.md}`,
	marginBottom: space.md,
	background: vars.color.badgeNewBg,
	color: vars.color.badgeNewText,
	borderRadius: radius.md,
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
});

export const cardStage = style({
	position: "relative",
	flex: 1,
	minHeight: 0,
	display: "flex",
});

export const card = style({
	width: "100%",
	background: vars.color.surface,
	border: `1px solid ${vars.color.borderStrong}`,
	borderRadius: radius.lg,
	boxShadow: "0 2px 10px rgb(0 0 0 / 5%)",
	overflow: "hidden",
	flex: 1,
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
});

export const face = style({
	display: "flex",
	flexDirection: "column",
	flex: "0 1 auto",
	minHeight: 0,
	overflow: "hidden",
});

const answerIn = keyframes({
	from: { opacity: 0, transform: "translateY(-8px)" },
	to: { opacity: 1, transform: "translateY(0)" },
});

export const answer = style({
	display: "flex",
	flexDirection: "column",
	borderTop: `1px solid ${vars.color.border}`,
	animation: `${answerIn} 0.3s ease`,
	flex: "0 1 auto",
	minHeight: 0,
	overflow: "hidden",
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
	borderBottom: `1px solid ${vars.color.border}`,
	background: vars.color.bg,
});

export const cardTabText = style({
	fontFamily: vars.font.display,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.color.ink,
});

export const cardTabNo = style({
	fontSize: textSize.xs,
	fontFamily: vars.font.mono,
	color: vars.color.inkFaint,
	fontVariantNumeric: "tabular-nums",
});

export const cardBody = style({
	flex: 1,
	padding: `${space.lg} ${space.xl}`,
	minHeight: 0,
	overflowY: "auto",
	display: "flex",
	flexDirection: "column",
	"@media": {
		"(max-width: 600px)": { padding: space.md },
	},
});

export const content = style({
	fontSize: textSize.base,
	lineHeight: 1.75,
	color: vars.color.ink,
	wordBreak: "break-word",
});

export const cardTools = style({
	display: "flex",
	alignItems: "center",
	gap: "2px",
	padding: `${space.xs} ${space.md}`,
	borderTop: `1px solid ${vars.color.border}`,
	background: vars.color.bg,
});

export const toolBtn = style({
	color: vars.color.inkMuted,
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
			background: vars.color.surfaceRaised,
		},
		"&:disabled": { opacity: 0.2, cursor: "default" },
	},
});

export const mnemonic = style({
	marginTop: space.md,
	padding: "12px 16px",
	background: vars.color.badgeReviewBg,
	border: `1px solid ${vars.color.badgeReviewText}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
});

export const mnemonicLabel = style({
	fontWeight: 600,
	marginBottom: 4,
	fontSize: 12,
	color: vars.color.badgeReviewText,
});

export const mnemonicLoading = style({
	color: vars.color.inkFaint,
});

export const banner = style({
	padding: `${space.sm} ${space.md}`,
	marginBottom: space.md,
	background: vars.color.badgeLearningBg,
	color: vars.color.badgeLearningText,
	borderRadius: radius.md,
	fontSize: textSize.sm,
});

export const cardFlat = style({
	background: vars.color.surface,
	border: `1px solid ${vars.color.borderStrong}`,
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
	fontFamily: vars.font.display,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.color.inkMuted,
	marginBottom: space.sm,
});

export const divider = style({
	height: 1,
	background: vars.color.border,
	margin: `${space.md} 0`,
});

export const editArea = style({
	width: "100%",
	padding: space.md,
	border: `1px solid ${vars.color.borderStrong}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	fontFamily: vars.font.mono,
	lineHeight: 1.6,
	resize: "vertical",
	background: vars.color.bg,
	color: vars.color.ink,
	transition: "border-color 0.15s, box-shadow 0.15s",
	boxSizing: "border-box",
	outline: "none",
	selectors: {
		"&:focus": {
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
		},
	},
});

export const actionRow = bottomBar;

export const ratings = composeStyles(
	bottomBar,
	style({
		maxWidth: 640,
		minWidth: 480,
		"@media": {
			"(max-width: 600px)": { maxWidth: "100%", minWidth: 0 }
		},
	}),
);

export const ratingBtn = style({
	display: "flex",
	flexDirection: "row",
	alignItems: "baseline", // label 与 time 基线对齐
	justifyContent: "center",
	gap: 6,
	flex: 1,
	padding: `${space.xs} 8px`,
	border: "1px solid transparent",
	borderRadius: radius.md,
	cursor: "pointer",
	transition: "filter 0.15s, transform 0.1s",
	"@media": {
		"(max-width: 600px)": {
			padding: `${space.xs} 4px`,
			borderRadius: 10,
			minHeight: 40,
			gap: 4,
		},
	},
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
	"@media": {
		"(max-width: 600px)": { fontSize: 15 },
	},
});

export const ratingTime = style({
	fontSize: 11,
	fontFamily: vars.font.mono,
	opacity: 0.8,
	"@media": {
		"(max-width: 600px)": { fontSize: 12 },
	},
});

export const again = style({
	background: vars.color.badgeRelearningBg,
	color: vars.color.badgeRelearningText,
});

export const hard = style({
	background: vars.color.badgeLearningBg,
	color: vars.color.badgeLearningText,
});

export const good = style({
	background: vars.color.badgeReviewBg,
	color: vars.color.badgeReviewText,
});

export const easy = style({
	background: vars.color.badgeNewBg,
	color: vars.color.badgeNewText,
});

export const empty = style({
	textAlign: "center",
	padding: `${space.xl} 0`,
	color: vars.color.inkFaint,
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: space.sm,
});

export const emptyTitle = style({
	fontFamily: vars.font.display,
	fontSize: textSize.lg,
	color: vars.color.ink,
});

export const emptyHint = style({
	fontSize: textSize.sm,
});

// cardBody 内内容不收缩（flex 容器默认 shrink 会压扁长内容）
globalStyle(`${cardBody} > *`, {
	flexShrink: 0,
});
