// ── 对话输入区：文本输入 + 发送（流式内容渲染在消息列表的 assistant 节点内） ──

import type { Accessor } from "solid-js";

/** 所需样式类：inputBar/inputShell/inputArea/sendBtn/stopBtn */
export type ComposerStyles = Record<string, string>;

/** 向上箭头（发送） */
function SendIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			width="16"
			height="16"
			fill="none"
			stroke="currentColor"
			stroke-width="2.5"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<line x1="12" y1="19" x2="12" y2="5" />
			<polyline points="5 12 12 5 19 12" />
		</svg>
	);
}

/** 方块（停止） */
function StopIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			width="12"
			height="12"
			fill="currentColor"
			aria-hidden="true"
		>
			<rect x="6" y="6" width="12" height="12" rx="1" />
		</svg>
	);
}

export function Composer(props: {
	styles: ComposerStyles;
	sending: Accessor<boolean>;
	input: Accessor<string>;
	onInput: (value: string) => void;
	onSend: () => void;
	/** 流式中点击停止生成 */
	onStop: () => void;
	placeholder: Accessor<string>;
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
					title={props.sending() ? "停止生成" : "发送"}
				>
					{props.sending() ? <StopIcon /> : <SendIcon />}
				</button>
			</div>
		</div>
	);
}
