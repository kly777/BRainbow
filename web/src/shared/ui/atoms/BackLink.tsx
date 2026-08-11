import { A } from "@solidjs/router";
import base from "@styles/base.module.css";

/** 通用返回链接（← 占位符 + base 的 btn-back 样式） */
export default function BackLink(props: {
	href: string;
	label?: string;
	class?: string;
}) {
	return (
		<A href={props.href} class={props.class ?? base.btnBack}>
			← {props.label ?? "返回"}
		</A>
	);
}
