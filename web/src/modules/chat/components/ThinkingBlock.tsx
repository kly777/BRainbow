// ── 思考过程折叠块：流式期间展示 AI 推理内容（思考中闪烁 + 计时，完成后展示耗时） ──

import { Markdown as MarkdownRenderer } from "@components/ui";
import {
	type Accessor,
	createEffect,
	createSignal,
	onCleanup,
	Show,
} from "solid-js";

/** 所需样式类：thinkingBlock/thinkingSummary/thinkingBody/thinkingActive */
export type ThinkingBlockStyles = Record<string, string>;

export function ThinkingBlock(props: {
	styles: ThinkingBlockStyles;
	/** 思考内容（空则不渲染） */
	reasoning: Accessor<string | undefined>;
	/** 思考是否已结束（content 开始输出）；true 后停止计时 */
	done?: Accessor<boolean>;
	/** 折叠默认状态（流式中默认展开便于查看，完成后收起） */
	open?: boolean;
}) {
	const [elapsed, setElapsed] = createSignal(0);

	// 思考期间每秒计时
	createEffect(() => {
		const reasoning = props.reasoning();
		if (!reasoning) {
			setElapsed(0);
			return;
		}
		if (props.done?.()) return;
		const start = Date.now();
		const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
		onCleanup(() => clearInterval(timer));
	});

	const title = () => {
		if (!props.done?.()) {
			return elapsed() > 0 ? `思考中 ${elapsed()}s` : "思考中…";
		}
		return elapsed() > 0 ? `思考过程 · ${elapsed()}s` : "思考过程";
	};

	return (
		<Show when={props.reasoning()}>
			<details class={props.styles.thinkingBlock} open={props.open ?? false}>
				<summary
					class={
						props.done?.()
							? props.styles.thinkingSummary
							: `${props.styles.thinkingSummary} ${props.styles.thinkingActive}`
					}
				>
					{title()}
				</summary>
				<div class={props.styles.thinkingBody}>
					<MarkdownRenderer content={props.reasoning() ?? ""} />
				</div>
			</details>
		</Show>
	);
}
