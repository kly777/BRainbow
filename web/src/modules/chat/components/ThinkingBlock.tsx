// ── 思考过程折叠块：流式期间展示 AI 推理内容（默认收起） ──

import { type Accessor, Show } from "solid-js";

/** 所需样式类：thinkingBlock/thinkingSummary/thinkingBody */
export type ThinkingBlockStyles = Record<string, string>;

export function ThinkingBlock(props: {
	styles: ThinkingBlockStyles;
	/** 思考内容（空则不渲染） */
	reasoning: Accessor<string | undefined>;
	/** 折叠默认状态（流式中默认展开便于查看，完成后收起） */
	open?: boolean;
}) {
	return (
		<Show when={props.reasoning()}>
			<details class={props.styles.thinkingBlock} open={props.open ?? false}>
				<summary class={props.styles.thinkingSummary}>思考过程</summary>
				<pre class={props.styles.thinkingBody}>{props.reasoning()}</pre>
			</details>
		</Show>
	);
}
