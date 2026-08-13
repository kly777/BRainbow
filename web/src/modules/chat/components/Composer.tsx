// ── 对话输入区：文本输入 + 发送（流式内容渲染在消息列表的 assistant 节点内） ──

import type { Accessor } from "solid-js";

/** 所需样式类：inputBar/inputShell/inputArea/sendBtn */
export type ComposerStyles = Record<string, string>;

export function Composer(props: {
	styles: ComposerStyles;
	sending: Accessor<boolean>;
	input: Accessor<string>;
	onInput: (value: string) => void;
	onSend: () => void;
	placeholder: Accessor<string>;
	sendLabel: Accessor<string>;
}) {
	const { styles } = props;

	return (
		<div class={styles.inputBar}>
			<div class={styles.inputShell}>
				<textarea
					class={styles.inputArea}
					placeholder={props.placeholder()}
					value={props.input()}
					onInput={(e) => props.onInput(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey) {
							e.preventDefault();
							props.onSend();
						}
					}}
				/>
				<button
					type="button"
					class={styles.sendBtn}
					disabled={props.sending() || !props.input().trim()}
					onClick={props.onSend}
				>
					{props.sendLabel()}
				</button>
			</div>
		</div>
	);
}
