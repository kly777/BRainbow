// ── 创建本体模态框（含内联样式，与 OntologyList 页共享视觉） ──

import { Button } from "@components/ui";
import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";
import styles from "../OntologyList.module.css";

export function CreateOntoModal(props: {
	open: Accessor<boolean>;
	name: Accessor<string>;
	setName: Setter<string>;
	description: Accessor<string>;
	setDescription: Setter<string>;
	creating: Accessor<boolean>;
	error: Accessor<string>;
	onCreate: () => void;
	onClose: () => void;
}) {
	return (
		<>
			<Show when={props.open()}>
				<div
					class={styles.modalOverlay}
					onClick={props.onClose}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							props.onClose();
						}
					}}
					role="dialog"
					aria-modal="true"
					aria-label="创建新本体"
					tabIndex={-1}
				>
					<div
						class={styles.modal}
						onClick={(e) => e.stopPropagation()}
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								props.onClose();
							}
						}}
						role="document"
						tabIndex={-1}
					>
						<div class={styles.modalHeader}>
							<h2>创建新本体</h2>
							<Button variant="icon" onClick={props.onClose} title="关闭">
								×
							</Button>
						</div>

						<div class={styles.modalContent}>
							<Show when={props.error()}>
								<div class={styles.errorMessage}>{props.error()}</div>
							</Show>

							<div class={styles.formGroup}>
								<label for="onto-name" class={styles.formLabel}>
									名称
								</label>
								<input
									id="onto-name"
									type="text"
									class={styles.formInput}
									value={props.name()}
									onInput={(e) => props.setName(e.currentTarget.value)}
									placeholder="请输入本体名称"
									disabled={props.creating()}
								/>
							</div>

							<div class={styles.formGroup}>
								<label for="onto-description" class={styles.formLabel}>
									描述
								</label>
								<textarea
									id="onto-description"
									class={styles.formTextarea}
									value={props.description()}
									onInput={(e) => props.setDescription(e.currentTarget.value)}
									placeholder="请输入本体描述（可选）"
									rows={4}
									disabled={props.creating()}
								/>
							</div>
						</div>

						<div class={styles.modalActions}>
							<Button
								variant="secondary"
								onClick={props.onClose}
								disabled={props.creating()}
							>
								取消
							</Button>
							<Button
								variant="primary"
								onClick={props.onCreate}
								disabled={props.creating()}
							>
								{props.creating() ? "创建中..." : "创建"}
							</Button>
						</div>
					</div>
				</div>
			</Show>

			{/* 模态框样式 */}
			<style>
				{`
				.modalOverlay {
					position: fixed;
					top: 0;
					left: 0;
					right: 0;
					bottom: 0;
					background-color: var(--t-color-overlay));
					display: flex;
					justify-content: center;
					align-items: center;
					z-index: 1000;
				}
				.modal {
					background-color: var(--t-color-surface));
					border-radius: 8px;
					width: 90%;
					max-width: 500px;
					box-shadow: 0 4px 20px oklch(0 0 0 / 0.15);
				}
				.modalHeader {
					display: flex;
					justify-content: space-between;
					align-items: center;
					padding: var(--space-lg) 20px;
					border-bottom: 1px solid var(--t-color-border));
				}
				.modalHeader h2 {
					font-size: 1.125rem;
					font-weight: 600;
					margin: 0;
				}
				.modalContent {
					padding: var(--space-lg) 20px;
				}
				.modalActions {
					display: flex;
					justify-content: flex-end;
					gap: var(--space-sm);
					padding: var(--space-lg) 20px;
					border-top: 1px solid var(--t-color-border));
				}
				.formGroup {
					margin-bottom: var(--space-lg);
				}
				.formLabel {
					display: block;
					font-size: 0.875rem;
					font-weight: 500;
					margin-bottom: var(--space-sm);
					color: var(--t-color-ink));
				}
				.formInput,
				.formTextarea {
					width: 100%;
					padding: var(--space-sm) 10px;
					font-size: 0.875rem;
					border: 1px solid var(--t-color-border));
					border-radius: var(--radius-sm);
					transition: all 0.2s ease;
					font-family: inherit;
				}
				.formInput:focus,
				.formTextarea:focus {
					outline: none;
					border-color: var(--t-color-accent));
					box-shadow: 0 0 0 3px var(--t-color-accent-ring), oklch(0.58 0.2 255 / 0.25));
				}
				.formTextarea {
					resize: vertical;
				}
				.errorMessage {
					padding: var(--space-sm) 10px;
					background: var(--t-color-danger-subtle));
					border: 1px solid var(--t-color-danger));
					border-radius: var(--radius-sm);
					color: var(--t-color-danger));
					font-size: 0.875rem;
					margin-bottom: var(--space-lg);
				}
				`}
			</style>
		</>
	);
}
