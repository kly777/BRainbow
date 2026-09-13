import styles from "@components/ui/atoms/Layout.module.css";
import { type JSX, splitProps } from "solid-js";

/** 间距档位，对应 global.css 的 --space-* 令牌 */
export type LayoutGap =
	| "none"
	| "2xs"
	| "xs"
	| "sm"
	| "md"
	| "lg"
	| "xl"
	| "2xl"
	| "3xl";

export type LayoutAlign = "start" | "center" | "end" | "baseline" | "stretch";
export type LayoutJustify = "start" | "center" | "end" | "between";

const GAP: Record<LayoutGap, string> = {
	none: styles.gapNone,
	"2xs": styles.gap2xs,
	xs: styles.gapXs,
	sm: styles.gapSm,
	md: styles.gapMd,
	lg: styles.gapLg,
	xl: styles.gapXl,
	"2xl": styles.gap2xl,
	"3xl": styles.gap3xl,
};

const ALIGN: Record<LayoutAlign, string> = {
	start: styles.alignStart,
	center: styles.alignCenter,
	end: styles.alignEnd,
	baseline: styles.alignBaseline,
	stretch: styles.alignStretch,
};

const JUSTIFY: Record<LayoutJustify, string> = {
	start: styles.justifyStart,
	center: styles.justifyCenter,
	end: styles.justifyEnd,
	between: styles.justifyBetween,
};

interface LayoutProps extends JSX.HTMLAttributes<HTMLDivElement> {
	gap?: LayoutGap;
	align?: LayoutAlign;
	justify?: LayoutJustify;
}

interface RowProps extends LayoutProps {
	/** 允许换行（对应 flex-wrap: wrap） */
	wrap?: boolean;
}

function join(...parts: (string | false | undefined)[]): string {
	return parts.filter(Boolean).join(" ");
}

/**
 * 水平布局原语：`display:flex` + 垂直居中（全站最高频的 flex 组合）。
 *
 * 居中是这个组件的显式默认值（而非某个 CSS 类名背后的隐含默认）：
 * 需要拉伸时传 `align="stretch"`，读代码即可知语义。
 * 其余样式通过 `class` 传入，与自身 CSS Module 合并。
 */
export function Row(props: RowProps) {
	const [local, rest] = splitProps(props, [
		"class",
		"gap",
		"align",
		"justify",
		"wrap",
	]);
	return (
		<div
			{...rest}
			class={join(
				styles.flex,
				local.align ? ALIGN[local.align] : styles.alignCenter,
				local.wrap && styles.wrap,
				local.justify && JUSTIFY[local.justify],
				local.gap && GAP[local.gap],
				local.class,
			)}
		/>
	);
}

/**
 * 垂直布局原语：`display:flex` + `flex-direction:column`。
 * 高度由内容决定，不设 flex:1 —— 需要撑满请在调用方 CSS 里声明。
 */
export function Stack(props: LayoutProps) {
	const [local, rest] = splitProps(props, ["class", "gap", "align", "justify"]);
	return (
		<div
			{...rest}
			class={join(
				styles.stack,
				local.align && ALIGN[local.align],
				local.justify && JUSTIFY[local.justify],
				local.gap && GAP[local.gap],
				local.class,
			)}
		/>
	);
}
