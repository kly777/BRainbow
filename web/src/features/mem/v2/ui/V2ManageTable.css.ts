/**
 * V2ManageTable — 管理表格（vanilla-extract 迁移）
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../../styles/tokens.css.ts";

export { btnNav as pageBtn } from "../../../../styles/base.css.ts";

export const tableCard = style({
	flex: 1,
	minHeight: 0,
	display: "flex",
	flexDirection: "column",
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
});

export const tableScroll = style({
	flex: 1,
	minHeight: 0,
	overflow: "auto",
});

export const table = style({
	width: "100%",
	borderCollapse: "collapse",
	fontSize: textSize.sm,
});

const thBase = {
	textAlign: "left" as const,
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	fontWeight: 500,
	textTransform: "uppercase" as const,
	letterSpacing: "0.05em",
	color: vars.v2.inkFaint,
	padding: "6px 10px",
	borderBottom: `1px solid ${vars.v2.border}`,
	whiteSpace: "nowrap" as const,
};

export const th = style({ ...thBase });

export const thSort = style({
	...thBase,
	cursor: "pointer",
	userSelect: "none",
	selectors: {
		"&:hover": { color: vars.v2.ink },
	},
});

export const thCb = style({
	...thBase,
	width: 32,
});

const tdBase = {
	padding: "8px 10px",
	borderBottom: `1px solid ${vars.v2.border}`,
	verticalAlign: "middle" as const,
};

export const td = style({
	...tdBase,
	color: vars.v2.ink,
	maxWidth: 220,
	overflow: "hidden",
	textOverflow: "ellipsis",
	whiteSpace: "nowrap",
	cursor: "pointer",
});

export const tdCb = style({ ...tdBase, width: 32 });

export const tdNum = style({
	...tdBase,
	fontFamily: vars.v2.fontMono,
	fontSize: 12,
	color: vars.v2.inkMuted,
	whiteSpace: "nowrap",
	fontVariantNumeric: "tabular-nums",
});

export const tdDue = style({
	...tdBase,
	fontFamily: vars.v2.fontMono,
	fontSize: 12,
	color: vars.v2.inkMuted,
	whiteSpace: "nowrap",
	fontVariantNumeric: "tabular-nums",
});

export const tdAct = style({
	...tdBase,
	width: 40,
	textAlign: "right",
});

export const row = style({
	transition: "background 0.1s",
	selectors: {
		"&:hover": { background: vars.v2.bg },
	},
});

export const rowActive = style({
	background: vars.v2.accentSoft,
	selectors: {
		"&:hover": { background: vars.v2.accentSoft },
	},
});

export const cellTags = style({
	display: "flex",
	gap: 4,
	flexWrap: "wrap",
});

export const cellTag = style({
	fontSize: 10,
	padding: "1px 6px",
	borderRadius: 999,
	background: vars.v2.badgeNewBg,
	color: vars.v2.badgeNewText,
	whiteSpace: "nowrap",
});

export const delBtn = style({
	background: "none",
	border: "none",
	color: vars.v2.inkFaint,
	cursor: "pointer",
	fontSize: 12,
	padding: "2px 4px",
	borderRadius: 4,
	selectors: {
		"&:hover": {
			color: vars.v2.badgeRelearningText,
			background: vars.v2.badgeRelearningBg,
		},
	},
});

export const pagination = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	gap: space.md,
	padding: `${space.md} 0 ${space.lg}`,
});

export const pageInfo = style({
	fontSize: 12,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	fontVariantNumeric: "tabular-nums",
});

export const empty = style({
	textAlign: "center",
	padding: `${space.xl} 0`,
	color: vars.v2.inkFaint,
});
