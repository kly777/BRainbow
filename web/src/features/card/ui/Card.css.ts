/**
 * Card — 目录卡（vanilla-extract 迁移，去双 fallback）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

// 删除中状态类（先定义，供 card 组合引用）
export const deleting = style({});

export const card = style({
	background: vars.v2.surface,
	borderRadius: radius.lg,
	boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)",
	padding: space.lg,
	transition: "all 0.2s ease",
	cursor: "pointer",
	border: `1px solid ${vars.v2.border}`,
	display: "flex",
	flexDirection: "column",
	textAlign: "left",
	width: "100%",
	overflowWrap: "break-word",
	overflowY: "auto",
	selectors: {
		[`&.${deleting}`]: {
			opacity: 0.5,
			pointerEvents: "none",
			transform: "scale(0.98)",
			transition: "all 0.3s ease",
		},
		"&:hover": {
			boxShadow: `0 ${space.xs} 16px oklch(0 0 0 / 0.12)`,
			transform: "translateY(-2px)",
			borderColor: vars.v2.accent,
		},
		"&:focus": {
			outline: `2px solid ${vars.v2.accent}`,
			outlineOffset: 2,
		},
		"&:active": { transform: "translateY(0)" },
	},
	"@media": {
		"(max-width: 768px)": { padding: space.md },
	},
});


export const cardHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	marginBottom: space.md,
	gap: space.sm,
});

export const cardTitle = style({
	fontSize: "1.125rem",
	fontWeight: 600,
	color: vars.v2.ink,
	margin: 0,
	flex: 1,
	lineHeight: 1.4,
	display: "-webkit-box",
	WebkitLineClamp: 2,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
	textOverflow: "ellipsis",
	"@media": {
		"(max-width: 768px)": { fontSize: "1rem" },
	},
});

export const cardCategory = style({
	background: vars.v2.accentSoft,
	color: vars.v2.accent,
	fontSize: "0.75rem",
	fontWeight: 500,
	padding: `${space.xs} 8px`,
	borderRadius: radius.sm,
	whiteSpace: "nowrap",
	flexShrink: 0,
});

export const cardContent = style({
	flex: 1,
	marginBottom: space.md,
	overflow: "hidden",
	display: "-webkit-box",
	WebkitLineClamp: 6,
	WebkitBoxOrient: "vertical",
});

export const cardPreview = style({
	fontSize: "0.875rem",
	lineHeight: 1.5,
	color: vars.v2.inkMuted,
	margin: 0,
	display: "-webkit-box",
	WebkitLineClamp: 4,
	WebkitBoxOrient: "vertical",
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "pre-line",
	"@media": {
		"(max-width: 768px)": { WebkitLineClamp: 3 },
	},
});

export const cardTags = style({
	display: "flex",
	flexWrap: "wrap",
	gap: space.xs,
	marginBottom: space.md,
});

export const tag = style({
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
	fontSize: "0.75rem",
	padding: "2px 8px",
	borderRadius: 999,
	border: "none",
	cursor: "pointer",
	transition: "all 0.15s ease",
	selectors: {
		"&:hover": {
			filter: "brightness(0.94)",
			color: vars.v2.badgeNewText,
		},
		"&:focus": {
			outline: `2px solid ${vars.v2.accent}`,
			outlineOffset: 1,
		},
	},
});

export const cardMeta = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
	marginBottom: space.md,
	fontSize: "0.75rem",
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
});

export const metaItem = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
});

export const metaLabel = style({
	fontWeight: 500,
	minWidth: 32,
});

export const metaValue = style({
	flex: 1,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const cardActions = style({
	display: "flex",
	gap: space.sm,
	marginTop: "auto",
	"@media": {
		"(max-width: 768px)": { gap: space.xs },
	},
});

export const actionButton = style({
	flex: 1,
	padding: `${space.xs} 12px`,
	fontSize: "0.875rem",
	borderRadius: radius.md,
	border: `1px solid ${vars.v2.borderStrong}`,
	background: "transparent",
	color: vars.v2.inkMuted,
	cursor: "pointer",
	transition: "all 0.15s ease",
	selectors: {
		"&:hover": { background: vars.v2.surfaceRaised, color: vars.v2.ink },
		"&:focus": {
			outline: `2px solid ${vars.v2.accent}`,
			outlineOffset: 1,
		},
	},
	"@media": {
		"(max-width: 768px)": { padding: space.sm },
	},
});

export const deleteButton = style({
	color: vars.v2.danger,
	borderColor: vars.v2.danger,
	selectors: {
		"&:hover": { background: vars.v2.danger, color: vars.v2.bg },
		"&:disabled": {
			opacity: 0.5,
			cursor: "not-allowed",
			background: vars.v2.dangerSubtle,
			color: vars.v2.danger,
			borderColor: vars.v2.danger,
		},
		"&:disabled:hover": {
			background: vars.v2.dangerSubtle,
			color: vars.v2.danger,
		},
	},
});
