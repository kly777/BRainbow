import base from "@styles/base.module.css";
import type { JSX } from "solid-js";

/**
 * 空状态原子：居中图标 + 提示文字 + 可选操作按钮。
 * 使用 base.module.css 的 empty-state / empty-icon / empty-hint / empty-action。
 */
export default function EmptyState(props: {
	icon?: JSX.Element;
	message: string;
	hint?: string;
	children?: JSX.Element;
	class?: string;
}) {
	return (
		<div class={base.emptyState}>
			{props.icon && <div class={base.emptyIcon}>{props.icon}</div>}
			<p>{props.message}</p>
			{props.hint && <p class={base.emptyHint}>{props.hint}</p>}
			{props.children && <div class={base.emptyAction}>{props.children}</div>}
		</div>
	);
}
