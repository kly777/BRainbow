/**
 * CardMasonry — 卡片瀑布流（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, vars } from "@styles/tokens.css.ts";

export const cardsGrid = style({
	paddingTop: 10,
	columnCount: "auto",
	columnGap: space.xl,
	width: "100%",
	flex: 1,
	overflowX: "auto",
	display: "flex",
	flexDirection: "column",
	flexWrap: "wrap",
	alignItems: "flex-start",
	"@media": {
		"(max-width: 1024px)": {
			columnWidth: 260,
			columnGap: space.lg,
		},
		"(max-width: 768px)": {
			columnWidth: 240,
			columnGap: space.md,
		},
		"(max-width: 480px)": {
			columnWidth: "auto",
			columnGap: space.md,
		},
	},
});

globalStyle(`${cardsGrid} > *`, {
	width: "var(--masonry-column-width, 300px)",
	flexGrow: 1,
	breakInside: "avoid",
	marginBottom: space.xl,
	"@media": {
		"(max-width: 1024px)": { marginBottom: space.lg },
		"(max-width: 768px)": { marginBottom: 14 },
		"(max-width: 480px)": { marginBottom: space.md },
	},
});

export const loadingMore = style({
	width: "var(--masonry-column-width, 300px)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	color: vars.v2.inkMuted,
	fontSize: "0.875rem",
	padding: space.xl,
});

export const emptyState = style({
	textAlign: "center",
	padding: space.xl,
	background: vars.v2.surface,
	borderRadius: radius.md,
	border: `2px dashed ${vars.v2.border}`,
	margin: `${space.xl} 0`,
	"@media": {
		"(max-width: 768px)": { padding: `${space.xl} 16px` },
	},
});

globalStyle(`${emptyState} p`, {
	fontSize: "1rem",
	color: vars.v2.inkMuted,
	marginBottom: space.xl,
});
