/**
 * TaskManager — 任务管理器（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const taskManager = style({
	maxWidth: 1440,
	margin: "0 auto",
	padding: `${space.md} 16px`,
	display: "flex",
	flexDirection: "column",
	flex: 1,
	minHeight: 0,
	gap: space.md,
	"@media": {
		"(max-width: 768px)": {
			margin: "0 auto",
			padding: `${space.sm} 12px`,
			gap: space.sm,
		},
	},
});

export const toolbar = style({
	display: "flex",
	alignItems: "center",
	gap: space.sm,
	padding: `${space.xs} 0`,
	flexShrink: 0,
	"@media": {
		"(max-width: 768px)": { flexWrap: "wrap" },
	},
});

export const viewSwitch = style({
	display: "flex",
	gap: space.xs,
	background: vars.v2.surfaceRaised,
	borderRadius: radius.md,
	padding: space.xs,
	flexShrink: 0,
});

export const viewBtn = style({
	padding: `${space.xs} 12px`,
	background: "none",
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.inkMuted,
	transition: "all 0.15s",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const viewActive = style({
	background: vars.v2.surface,
	color: vars.v2.ink,
	boxShadow: "0 1px 2px oklch(0 0 0 / 0.06)",
});

export const searchBox = style({
	position: "relative",
	flex: 1,
	minWidth: 0,
	maxWidth: 240,
});

export const searchInput = style({
	width: "100%",
	padding: `${space.xs} 24px ${space.xs} ${space.sm}`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	outline: "none",
	background: vars.v2.bg,
	boxSizing: "border-box",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent, background: vars.v2.surface },
	},
});

export const searchClear = style({
	position: "absolute",
	right: 4,
	top: "50%",
	transform: "translateY(-50%)",
	background: "none",
	border: "none",
	color: vars.v2.inkMuted,
	cursor: "pointer",
	fontSize: textSize.base,
	padding: `${space.xs} 4px`,
});

export const quickAddBox = style({
	flexShrink: 0,
});

export const quickAddInput = style({
	padding: `${space.xs} 10px`,
	border: `1px dashed ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	outline: "none",
	color: vars.v2.inkMuted,
	background: "none",
	width: 140,
	boxSizing: "border-box",
	transition: "all 0.15s",
	selectors: {
		"&:focus": {
			borderColor: vars.v2.success,
			borderStyle: "solid",
			color: vars.v2.ink,
			width: 200,
		},
		"&::placeholder": { color: vars.v2.inkMuted },
	},
	"@media": {
		"(max-width: 768px)": { width: 110 },
	},
});

export const quickAddFocus = style({
	width: 150,
});

export const loading = style({
	textAlign: "center",
	padding: space.xl,
	color: vars.v2.inkMuted,
	fontSize: textSize.base,
});

export const splitView = style({
	display: "grid",
	gridTemplateColumns: "1fr 1fr",
	gap: space.lg,
	alignItems: "start",
	flex: 1,
	minHeight: 0,
	"@media": {
		"(max-width: 768px)": { gridTemplateColumns: "1fr" },
	},
});

export const rightPanel = style({
	minHeight: 0,
	overflowY: "auto",
	display: "flex",
	flexDirection: "column",
	gap: space.sm,
});

export const tabBar = style({
	display: "flex",
	gap: space.xs,
	background: vars.v2.surfaceRaised,
	borderRadius: radius.md,
	padding: space.xs,
	flexShrink: 0,
});

export const tabBtn = style({
	flex: 1,
	padding: `${space.sm} ${space.md}`,
	background: "transparent",
	border: "none",
	borderRadius: radius.md,
	cursor: "pointer",
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.inkMuted,
	transition: "all 0.15s",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const tabActive = style({
	background: vars.v2.surface,
	color: vars.v2.ink,
	boxShadow: "0 1px 2px oklch(0 0 0 / 0.08)",
});
