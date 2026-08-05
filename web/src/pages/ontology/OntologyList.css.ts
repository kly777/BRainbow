/**
 * OntologyList — 本体列表（vanilla-extract 迁移，v2 令牌）
 */
import { globalStyle, style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "@styles/tokens.css.ts";

export const container = style({
	maxWidth: 1440,
	margin: "0 auto",
	padding: space.xl,
	"@media": {
		"(max-width: 768px)": { padding: space.lg },
	},
});

export const header = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: 30,
	paddingBottom: 20,
	borderBottom: `1px solid ${vars.v2.border}`,
	"@media": {
		"(max-width: 768px)": {
			flexDirection: "column",
			alignItems: "flex-start",
			gap: space.md,
		},
	},
});

globalStyle(`${header} h1`, {
	margin: 0,
	color: vars.v2.ink,
	fontSize: textSize.xl,
	fontWeight: 600,
	"@media": {
		"(max-width: 480px)": { fontSize: textSize.lg },
	},
});

export const actions = style({
	display: "flex",
	gap: space.sm,
});

export const filters = style({
	backgroundColor: vars.v2.surface,
	borderRadius: radius.md,
	padding: space.xl,
	marginBottom: 30,
	boxShadow: "0 2px 4px oklch(0 0 0 / 0.05)",
	"@media": {
		"(max-width: 480px)": { padding: space.lg },
	},
});

export const searchSection = style({
	marginBottom: space.xl,
});

export const entitiesGrid = style({
	display: "grid",
	gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
	gap: space.xl,
	marginBottom: 30,
	"@media": {
		"(max-width: 768px)": {
			gridTemplateColumns: "1fr",
			gap: space.lg,
		},
	},
});

export const entityCard = style({
	backgroundColor: vars.v2.surface,
	borderRadius: radius.md,
	padding: space.xl,
	boxShadow: "0 2px 8px oklch(0 0 0 / 0.08)",
	transition: "transform 0.2s, box-shadow 0.2s",
	display: "flex",
	flexDirection: "column",
	height: "100%",
	selectors: {
		"&:hover": {
			transform: "translateY(-2px)",
			boxShadow: `0 ${space.xs} ${space.md} oklch(0 0 0 / 0.12)`,
		},
	},
});

export const entityHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "flex-start",
	marginBottom: 15,
});

export const entityName = style({
	margin: 0,
	fontSize: textSize.lg,
	fontWeight: 600,
	color: vars.v2.ink,
	flex: 1,
});

export const entityType = style({
	color: vars.v2.white,
	padding: `${space.xs} 10px`,
	borderRadius: radius.lg,
	fontSize: textSize.sm,
	fontWeight: 500,
	marginLeft: 10,
	whiteSpace: "nowrap",
});

export const entityDescription = style({
	fontSize: "0.9375rem",
	lineHeight: 1.6,
	color: vars.v2.ink,
	marginBottom: 15,
	flex: 1,
});

globalStyle(`${entityDescription} p`, {
	margin: 0,
});

export const entityActions = style({
	display: "flex",
	gap: space.sm,
	marginTop: "auto",
	paddingTop: 15,
	borderTop: `1px solid ${vars.v2.border}`,
});

export const entitiesList = style({
	overflowX: "auto",
	marginBottom: 30,
});

export const entitiesTable = style({
	width: "100%",
	borderCollapse: "collapse",
	fontSize: "0.9375rem",
});

export const entitiesTh = style({
	padding: `${space.md} 16px`,
	textAlign: "left",
	fontWeight: 600,
	color: vars.v2.inkMuted,
	backgroundColor: vars.v2.surfaceRaised,
	borderBottom: `2px solid ${vars.v2.border}`,
	whiteSpace: "nowrap",
});

export const entitiesTd = style({
	padding: `${space.md} 16px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	color: vars.v2.ink,
});

globalStyle(`${entitiesTable} tr:hover td`, {
	backgroundColor: vars.v2.surfaceRaised,
});

export const stats = style({
	marginTop: 20,
	paddingTop: 20,
	borderTop: `1px solid ${vars.v2.border}`,
	textAlign: "center",
});

globalStyle(`${stats} p`, {
	margin: 0,
	fontSize: "0.875rem",
	color: vars.v2.inkMuted,
});

// ── 新增实体弹窗（原 module.css 未定义，补基础样式） ──
export const modalOverlay = style({
	position: "fixed",
	inset: 0,
	background: "oklch(0 0 0 / 0.5)",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	zIndex: 1000,
	padding: space.xl,
});

export const modal = style({
	background: vars.v2.surface,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.lg,
	padding: space.xl,
	width: "100%",
	maxWidth: 520,
	maxHeight: "90vh",
	overflowY: "auto",
	boxShadow: "0 8px 32px oklch(0 0 0 / 0.15)",
});

export const modalHeader = style({
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginBottom: space.lg,
});

export const modalContent = style({
	display: "flex",
	flexDirection: "column",
	gap: space.md,
});

export const errorMessage = style({
	color: vars.v2.danger,
	fontSize: textSize.sm,
	background: vars.v2.dangerSubtle,
	padding: space.sm,
	borderRadius: radius.sm,
});

export const formGroup = style({
	display: "flex",
	flexDirection: "column",
	gap: space.xs,
});

export const formLabel = style({
	fontSize: textSize.sm,
	fontWeight: 500,
	color: vars.v2.ink,
});

export const formInput = style({
	padding: `${space.sm} 12px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	background: vars.v2.bg,
	color: vars.v2.ink,
	outline: "none",
});

export const formTextarea = style({
	padding: `${space.sm} 12px`,
	border: `1px solid ${vars.v2.border}`,
	borderRadius: radius.md,
	fontSize: textSize.base,
	background: vars.v2.bg,
	color: vars.v2.ink,
	outline: "none",
	resize: "vertical",
	minHeight: 80,
});

export const modalActions = style({
	display: "flex",
	justifyContent: "flex-end",
	gap: space.sm,
	marginTop: space.lg,
});
