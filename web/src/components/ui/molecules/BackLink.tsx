import { ArrowLeft } from "@components/ui/icons";
import { A } from "@solidjs/router";
import type { Component } from "solid-js";
import styles from "./BackLink.module.css";

interface BackLinkProps {
	href: string;
	/** 返回目标文案，如「文章列表」 */
	label: string;
	/** 图标尺寸；默认 14 —— 改造前各页取值 14 / 16 不一，先按调用点保留原值 */
	size?: number;
	/** 调用方布局类（网格跨列、外边距等），拼在共享类之后 */
	class?: string;
}

/**
 * 详情页返回链接。
 *
 * 与 `Toolbar` 的返回**按钮**分工不同：这里渲染的是真正的 `<a href>` ——
 * 可中键新开、可复制链接，用在"返回列表 / 返回搜索"这类有明确 URL 的场景；
 * `Toolbar` 的返回按钮留给"返回上一状态"（如取消编辑）。
 *
 * 改造前这段标签在 `ConvSearch` / `ConvDetail`（经 `ConvTopBar`）/ `ReadingDetail` /
 * `ReadingUnknown` 各写了一份，连同各自的 `.back-link` 规则 —— 样式都是
 * "accent 文字 + 悬停下划线 + text-sm"，只是散在四处。
 */
const BackLink: Component<BackLinkProps> = (props) => (
	<A
		href={props.href}
		class={`${styles.back}${props.class ? ` ${props.class}` : ""}`}
	>
		<ArrowLeft size={props.size ?? 14} /> {props.label}
	</A>
);

export default BackLink;
