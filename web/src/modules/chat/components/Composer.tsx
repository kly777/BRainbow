// ── 对话输入区：文本输入 + 发送（流式内容渲染在消息列表的 assistant 节点内） ──

import type { Accessor } from "solid-js";

/** 所需样式类：inputBar/inputShell/inputArea/sendBtn/stopBtn */
export type ComposerStyles = Record<string, string>;

export function Composer(props: {
	styles: ComposerStyles;
	sending: Accessor<boolean>;
	input: Accessor<string>;
	onInput: (value: string) => void;
	onSend: () => void;
	/** 流式中点击停止生成 */
	onStop: () => void;
	placeholder: Accessor<string>;
	sendLabel: Accessor<string>;
}) {
	const { styles } = props;

	/** textarea 自动增高（1 行 → max-height），超限滚动 */
	const autoGrow = (el: HTMLTextAreaElement) => {
		el.style.height = "auto";
		const max = parseInt(getComputedStyle(el).maxHeight, 10) || 160;
		el.style.height = `${Math.min(el.scrollHeight, max)}px`;
	};

	return (
		<div class={styles.inputBar}>
			<div class={styles.inputShell}>
				<textarea
					ref={(el) => requestAnimationFrame(() => autoGrow(el))}
					class={styles.inputArea}
					placeholder={props.placeholder()}
					value={props.input()}
					onInput={(e) => {
						props.onInput(e.currentTarget.value);
						autoGrow(e.currentTarget);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							props.onSend();
						}
					}}
				/>
				<button
					type="button"
					class={props.sending() ? styles.stopBtn : styles.sendBtn}
					disabled={!props.sending() && !props.input().trim()}
					onClick={props.sending() ? props.onStop : props.onSend}
					title={props.sending() ? "停止生成" : undefined}
				>
					{props.sending() ? "停止" : props.sendLabel()}
				</button>
			</div>
		</div>
	);
}
