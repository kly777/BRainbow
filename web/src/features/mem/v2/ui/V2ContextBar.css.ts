/**
 * V2ContextBar — vanilla-extract 试点
 * 按钮复用 base.css.ts 通用件，其余样式就地定义
 */
import { style } from "@vanilla-extract/css";
import { radius, space, textSize, vars } from "../../../../styles/tokens.css.ts";

// 按钮复用 base 通用件（re-export 保持调用方 styles.btnGhost 不变）
export { btnGhost, btnPrimary } from "../../../../styles/base.css.ts";

export const contextBar = style({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: space.lg,
	padding: `${space.xs} 20px`,
	borderBottom: `1px solid ${vars.v2.border}`,
	background: vars.v2.surface,
	flexShrink: 0,
	flexWrap: "wrap",
	"@media": {
		"(max-width: 600px)": { paddingLeft: 12, paddingRight: 12 },
	},
});

export const ctxStats = style({
	display: "flex",
	alignItems: "center",
	gap: space.md,
});

export const ctxStat = style({
	fontSize: textSize.xs,
	fontFamily: vars.v2.fontMono,
	color: vars.v2.inkFaint,
	whiteSpace: "nowrap",
	fontVariantNumeric: "tabular-nums",
});

export const ctxActions = style({
	display: "flex",
	alignItems: "center",
	gap: space.xs,
});
