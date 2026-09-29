import { Button } from "@components/kumo";
import { X } from "@components/ui/icons";
import type { Component } from "solid-js";
import styles from "./DialogCloseButton.module.css";

/**
 * Kumo 的 Dialog **不自带关闭按钮**（上游把它留给调用方），而本项目原来的
 * Modal 有右上角的 ×。这个小组件把那枚 × 补回来，放在 Dialog 内容里即可。
 *
 * 定位是相对 Dialog 面板的：kumo 的面板自身是 `fixed`，所以这里的 `absolute`
 * 落在面板右上角，不需要调用方再给定位类。
 *
 * **不给 title**：kumo 的 title 会渲染成 Tooltip，而 base-ui 的浮层在打开时按 Esc
 * 会 stopImmediatePropagation —— 弹窗刚打开时焦点正落在这枚按钮上，第一次 Esc
 * 会被 Tooltip 吃掉、关不掉弹窗。可访问名用 aria-label 就够了。
 */
const DialogCloseButton: Component<{
	onClose: () => void;
	/** 可访问名文案（默认「关闭」） */
	label?: string;
}> = (props) => (
	<Button
		shape="square"
		variant="ghost"
		size="sm"
		className={styles.close}
		aria-label={props.label ?? "关闭"}
		icon={<X size={16} />}
		onClick={props.onClose}
	/>
);

export default DialogCloseButton;
