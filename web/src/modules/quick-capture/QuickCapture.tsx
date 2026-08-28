// ── 全局快速记录浮窗 ──
// Shift+Tab 唤起，快速创建任务/卡片/书签

import { Show } from "solid-js";
import styles from "./QuickCapture.module.css";
import {
	getTypeEmoji,
	getTypeHint,
	useQuickCapture,
} from "./useQuickCapture.ts";

export default function QuickCapture() {
	const qc = useQuickCapture();

	return (
		<Show when={qc.open()}>
			{/* 遮罩 */}
			<button
				type="button"
				class={styles.overlay}
				onClick={qc.close}
				aria-label="关闭快速记录"
			/>

			{/* 浮窗 */}
			<div
				class={styles.dialog}
				role="dialog"
				aria-modal="true"
				aria-label="快速记录"
			>
				<div class={styles.header}>
					<span class={styles.headerIcon}>⚡</span>
					<span class={styles.headerTitle}>快速记录</span>
					<span class={styles.shortcutHint}>
						<kbd>Shift</kbd>+<kbd>Tab</kbd>
					</span>
				</div>

				<div class={styles.inputRow}>
					<span class={styles.typeIndicator}>{getTypeEmoji(qc.type())}</span>
					<input
						class={styles.input}
						value={qc.inputValue()}
						onInput={(e) => qc.setInputValue(e.currentTarget.value)}
						onKeyDown={qc.onInputKey}
						placeholder="输入内容… #任务 @URL 保存为卡片"
						autofocus
					/>
				</div>

				<div class={styles.footer}>
					<div class={styles.typeHint}>{getTypeHint(qc.type())}</div>
					<div class={styles.actions}>
						<button type="button" class={styles.cancelBtn} onClick={qc.close}>
							取消
						</button>
						<button
							type="button"
							class={styles.submitBtn}
							onClick={() => qc.commit()}
							disabled={qc.creating() || !qc.cleanValue()}
						>
							{qc.creating() ? "创建中…" : "保存"}
						</button>
					</div>
				</div>

				<div class={styles.helpText}>
					<span>
						<kbd>#</kbd> 任务
					</span>
					<span>
						<kbd>@</kbd> 书签
					</span>
					<span>默认 卡片</span>
				</div>
			</div>
		</Show>
	);
}
