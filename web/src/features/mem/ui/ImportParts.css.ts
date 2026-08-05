/**
 * ImportParts — 批量导入部件（vanilla-extract 迁移）
 * 按钮复用 base.css.ts
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../styles/tokens.css.ts";

export { btnGhost as cancel, btnPrimary as submit } from "../../../styles/base.css.ts";

export const hintCard = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	overflow: "hidden",
});

export const hintTab = style({
	display: "flex",
	alignItems: "center",
	padding: `${space.sm} ${space.md}`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const hintTabText = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.ink,
});

export const hintBody = style({
	padding: space.md,
});

export const hintLead = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	margin: `0 0 ${space.sm}`,
});

export const hintBlock = style({
	marginBottom: space.md,
	selectors: {
		"&:last-child": { marginBottom: 0 },
	},
});

export const hintName = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.sm,
	fontWeight: 600,
	margin: "0 0 4px",
	color: vars.v2.ink,
});

export const hintExample = style({
	fontFamily: vars.v2.fontMono,
	fontSize: 12,
	lineHeight: 1.6,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: `${space.sm} ${space.md}`,
});

export const hintNote = style({
	fontSize: 11,
	color: vars.v2.inkFaint,
	margin: 0,
});

export const label = style({
	display: "block",
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
});

export const textInput = style({
	width: "100%",
	fontSize: textSize.sm,
	color: vars.v2.ink,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: `${space.sm} 10px`,
});

export const previewCard = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	overflow: "hidden",
});

export const previewTab = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	padding: `${space.sm} ${space.md}`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const previewTabText = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.ink,
});

export const previewTabNo = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.accent,
});

export const previewBody = style({
	overflowX: "auto",
	padding: space.sm,
});

export const previewTable = style({
	width: "100%",
	borderCollapse: "collapse",
	fontSize: textSize.sm,
});

export const previewTh = style({
	textAlign: "left",
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	fontWeight: 500,
	textTransform: "uppercase",
	letterSpacing: "0.05em",
	color: vars.v2.inkFaint,
	padding: "6px 8px",
});

export const previewTd = style({
	padding: "6px 8px",
	borderBottom: `1px solid ${vars.v2.border}`,
	color: vars.v2.ink,
	maxWidth: 240,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const previewTag = style({
	display: "inline-block",
	fontSize: textSize.xs,
	padding: "1px 6px",
	marginRight: 4,
	borderRadius: 999,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
});

export const previewCount = style({
	fontSize: 12,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	margin: `${space.sm} ${space.md} 0`,
});

export const tagCard = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	padding: space.md,
});

export const importErrors = style({
	fontSize: textSize.sm,
	color: vars.v2.badgeRelearningText,
	margin: `${space.sm} 0 0`,
});

export const importErrorList = style({
	margin: `${space.xs} 0 0`,
	paddingLeft: space.lg,
	fontSize: textSize.sm,
	color: vars.v2.badgeRelearningText,
});

export const resultCard = style({
	width: "100%",
	maxWidth: 480,
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.lg,
	padding: space.xl,
	textAlign: "center",
	alignSelf: "flex-start",
});

export const resultMark = style({
	width: 48,
	height: 48,
	margin: `0 auto ${space.md}`,
	borderRadius: "50%",
	background: vars.v2.accent,
	color: vars.v2.white,
	fontSize: 24,
	lineHeight: "48px",
});

export const resultTitle = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.lg,
	color: vars.v2.ink,
});

export const resultActions = style({
	display: "flex",
	gap: space.sm,
	justifyContent: "center",
});
