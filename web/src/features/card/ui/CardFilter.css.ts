/**
 * CardFilter — 卡片过滤器（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

export const filters = style({
	background: vars.color.surface,
	borderRadius: radius.lg,
	padding: space.md,
	marginBottom: space.lg,
	boxShadow: "0 1px 4px oklch(0 0 0 / 0.06)",
	border: `1px solid ${vars.color.border}`,
	"@media": {
		"(max-width: 480px)": { padding: space.md },
	},
});

export const filterRow = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
	flexWrap: "wrap",
});

export const filterControls = style({
	display: "flex",
	gap: space.md,
	alignItems: "center",
	flexWrap: "wrap",
});

export const searchInput = style({
	flex: 1,
	minWidth: 0,
	maxWidth: 220,
	padding: `${space.sm} 12px`,
	fontSize: "0.875rem",
	border: `1px solid ${vars.color.borderStrong}`,
	borderRadius: radius.md,
	background: vars.color.bg,
	color: vars.color.ink,
	transition: "all 0.15s ease",
	flexShrink: 0,
	outline: "none",
	selectors: {
		"&:focus": {
			borderColor: vars.color.accent,
			boxShadow: `0 0 0 2px ${vars.color.accentSoft}`,
		},
		"&::placeholder": { color: vars.color.inkFaint },
	},
	"@media": {
		"(max-width: 480px)": {
			fontSize: "1.125rem",
			padding: `${space.sm} 14px`,
		},
	},
});

export const filterLabel = style({
	fontSize: "0.875rem",
	fontWeight: 500,
	color: vars.color.ink,
	whiteSpace: "nowrap",
});

export const filterSelect = style({
	padding: `${space.sm} 12px`,
	fontSize: "0.875rem",
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	background: vars.color.bg,
	color: vars.color.ink,
	cursor: "pointer",
	minWidth: 120,
	outline: "none",
	selectors: {
		"&:focus": { borderColor: vars.color.accent },
	},
	"@media": {
		"(max-width: 768px)": { width: "100%" },
	},
});

export const sortButton = style({
	padding: `${space.sm} 12px`,
	fontSize: "0.875rem",
	background: "transparent",
	color: vars.color.inkMuted,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	transition: "all 0.15s ease",
	minWidth: 40,
	selectors: {
		"&:hover": { background: vars.color.surfaceRaised, color: vars.color.ink },
	},
	"@media": {
		"(max-width: 480px)": { flex: 1, textAlign: "center" },
	},
});

export const clearButton = style({
	padding: `${space.sm} 14px`,
	fontSize: "0.875rem",
	background: "transparent",
	color: vars.color.inkMuted,
	border: `1px solid ${vars.color.border}`,
	borderRadius: radius.md,
	cursor: "pointer",
	transition: "all 0.15s ease",
	whiteSpace: "nowrap",
	flexShrink: 0,
	selectors: {
		"&:hover:not(:disabled)": {
			background: vars.color.surfaceRaised,
			color: vars.color.ink,
		},
		"&:disabled": { opacity: 0.5, cursor: "not-allowed" },
	},
});
