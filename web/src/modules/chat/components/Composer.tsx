// ── 对话输入区：流式生成行 + 文本输入 + 发送 ──

import { Markdown as MarkdownRenderer } from "@components/ui";
import { type Accessor, Show } from "solid-js";

/** 所需样式类：inputBar/inputShell/inputArea/sendBtn/messageRow/streaming/avatar/messageCol/messageHead/messageRole/assistantBubble/messageMd/streamCursor */
export type ComposerStyles = Record<string, string>;

export function Composer(props: {
	styles: ComposerStyles;
	sending: Accessor<boolean>;
	streamingContent: Accessor<string>;
	input: Accessor<string>;
	onInput: (value: string) => void;
	onSend: () => void;
	placeholder: Accessor<string>;
	sendLabel: Accessor<string>;
}) {
	const { styles } = props;

	return (
		<>
			<Show when={props.sending() && props.streamingContent()}>
				<div class={`${styles.messageRow} ${styles.streaming}`}>
					<span class={styles.avatar} aria-hidden="true">
						AI
					</span>
					<div class={styles.messageCol}>
						<div class={styles.messageHead}>
							<span class={styles.messageRole}>AI · 生成中…</span>
						</div>
						<div class={styles.assistantBubble}>
							<div class={styles.messageMd}>
								<MarkdownRenderer content={props.streamingContent()} />
								<span class={styles.streamCursor} />
							</div>
						</div>
					</div>
				</div>
			</Show>
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
		</>
	);
}
