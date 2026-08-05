/**
 * MemAdd — 页面布局（vanilla-extract 迁移）
 * 按钮/输入复用 base.css.ts
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../styles/tokens.css.ts";

// 按钮/提交复用 base 通用件（组件引用 styles.cancel / styles.submit）
export { btnGhost as cancel, btnPrimary as submit } from "../../styles/base.css.ts";
export { btnBack as backLink } from "../../styles/base.css.ts";

export const page = style({
	display: "flex",
	flexDirection: "column",
	minHeight: "100vh",
	background: vars.v2.bg,
	color: vars.v2.ink,
});

export const topBar = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	padding: `${space.sm} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
	flexShrink: 0,
	flexWrap: "wrap",
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const title = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.lg,
	fontWeight: 600,
	letterSpacing: "0.08em",
	margin: 0,
	color: vars.v2.ink,
	flex: 1,
	"@media": {
		"(max-width: 600px)": { fontSize: textSize.base },
	},
});

export const modeTabs = style({
	display: "flex",
	gap: 2,
	background: vars.v2.bg,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	padding: 2,
	"@media": {
		"(max-width: 600px)": {
			order: 3,
			width: "100%",
			justifyContent: "stretch",
		},
	},
});

export const modeBtn = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	background: "transparent",
	border: "none",
	borderRadius: `calc(${radius.md} - 2px)`,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	whiteSpace: "nowrap",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
	"@media": {
		"(max-width: 600px)": { flex: 1, textAlign: "center", padding: `${space.xs} 6px` },
	},
});

export const modeActive = style({
	fontSize: textSize.sm,
	color: vars.v2.white,
	background: vars.v2.accent,
	border: "none",
	borderRadius: `calc(${radius.md} - 2px)`,
	padding: `${space.xs} 12px`,
	cursor: "pointer",
	fontWeight: 500,
	whiteSpace: "nowrap",
	"@media": {
		"(max-width: 600px)": { flex: 1, textAlign: "center", padding: `${space.xs} 6px` },
	},
});

export const content = style({
	flex: 1,
	padding: `${space.xl} 20px`,
	display: "flex",
	justifyContent: "center",
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const cardWrap = style({
	width: "100%",
	maxWidth: 640,
});

export const card = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.borderStrong}`,
	borderRadius: radius.lg,
	overflow: "hidden",
	boxShadow: "0 2px 10px rgb(0 0 0 / 5%)",
});

export const face = style({
	display: "flex",
	flexDirection: "column",
});

export const faceTab = style({
	display: "flex",
	alignItems: "baseline",
	justifyContent: "space-between",
	gap: space.sm,
	padding: `${space.sm} ${space.md}`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.bg,
});

export const faceTabText = style({
	fontFamily: vars.v2.fontDisplay,
	fontSize: textSize.xs,
	fontWeight: 600,
	letterSpacing: "0.12em",
	textTransform: "uppercase",
	color: vars.v2.ink,
});

export const faceTabNo = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
});

export const faceBody = style({
	padding: space.md,
});

export const textarea = style({
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

export const fold = style({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	padding: `${space.sm} 0`,
	borderTop: `1px dashed ${vars.v2.borderStrong}`,
	borderBottom: `1px dashed ${vars.v2.borderStrong}`,
	background: vars.v2.bg,
});

export const foldMark = style({
	fontSize: 11,
	fontFamily: vars.v2.fontMono,
	letterSpacing: "0.2em",
	color: vars.v2.inkFaint,
});

export const actions = style({
	display: "flex",
	justifyContent: "flex-end",
	gap: space.sm,
	marginTop: space.lg,
});

export const inputCard = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	padding: space.md,
});

export const fileBtn = style({
	display: "inline-flex",
	alignItems: "center",
	gap: space.sm,
	fontSize: textSize.sm,
	color: vars.v2.white,
	background: vars.v2.accent,
	border: "none",
	borderRadius: radius.md,
	padding: `${space.sm} 20px`,
	cursor: "pointer",
	fontWeight: 500,
	transition: "background 0.15s",
	selectors: {
		"&:hover": { background: vars.v2.accentStrong },
	},
});

export const fileInputHidden = style({
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clipPath: "inset(50%)",
	whiteSpace: "nowrap",
	border: 0,
});

export const importErrors = style({
	fontSize: textSize.sm,
	color: vars.v2.badgeRelearningText,
	margin: `${space.sm} 0 0`,
});

export const previewCount = style({
	fontSize: 12,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	margin: `${space.sm} ${space.md} 0`,
});

export const stack = style({
	width: "100%",
	maxWidth: 680,
	display: "flex",
	flexDirection: "column",
	gap: space.md,
});
