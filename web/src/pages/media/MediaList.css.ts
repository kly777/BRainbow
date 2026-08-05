/**
 * MediaList — 媒体列表（vanilla-extract 迁移，v2 令牌）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const page = style({
	maxWidth: 1440,
	margin: "0 auto",
	padding: `${space.xl} 20px`,
});

export const title = style({
	fontSize: textSize.xl,
	fontWeight: 700,
	color: vars.v2.ink,
	margin: `0 0 ${space.xl} 0`,
});

export const grid = style({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
	gap: space.lg,
	"@media": {
		"(max-width: 640px)": {
			gridTemplateColumns: "repeat(2, 1fr)",
			gap: space.sm,
		},
	},
});

export const card = style({
	background: vars.v2.surface,
	borderRadius: radius.md,
	border: `1px solid ${vars.v2.border}`,
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
});

export const preview = style({
	aspectRatio: "16 / 10",
	background: vars.v2.bg,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	overflow: "hidden",
});

export const previewLink = style({
	width: "100%",
	height: "100%",
	display: "block",
});

export const thumb = style({
	width: "100%",
	height: "100%",
	objectFit: "contain",
	display: "block",
	imageRendering: "pixelated",
});

export const iconPreview = style({
	fontSize: textSize.xl,
	opacity: 0.5,
});

export const info = style({
	padding: space.md,
	flex: 1,
});

export const name = style({
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.ink,
	margin: `0 0 ${space.xs} 0`,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
});

export const meta = style({
	fontSize: textSize.sm,
	color: vars.v2.inkMuted,
	margin: 0,
});

export const actions = style({
	display: "flex",
	gap: space.xs,
	padding: `${space.sm} 12px`,
	borderTop: `1px solid ${vars.v2.border}`,
});

export const editRow = style({
	display: "flex",
	gap: space.xs,
	padding: space.md,
	flexDirection: "column",
});

export const editInput = style({
	padding: `${space.xs} 10px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.sm,
	fontFamily: "inherit",
	outline: "none",
	selectors: {
		"&:focus": { borderColor: vars.v2.accent },
	},
});

export const error = style({
	color: vars.v2.danger,
	fontSize: textSize.sm,
	margin: `0 0 ${space.md} 0`,
});
