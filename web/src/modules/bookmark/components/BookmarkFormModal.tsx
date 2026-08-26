// ── /bookmark 表单弹窗（新建/编辑） ──

import { Button, Modal } from "@components/ui";
import { Show } from "solid-js";
import styles from "../BookmarkPage.module.css";
import type { useBookmarkPage } from "../hooks/useBookmarkPage.ts";
import TagInput from "./TagInput.tsx";

export function BookmarkFormModal(props: {
	b: ReturnType<typeof useBookmarkPage>;
}) {
	const { b } = props;
	const handleSubmit = (e: Event) => {
		e.preventDefault();
		if (!b.saving()) b.handleSave();
	};
	return (
		<Modal
			isOpen={b.modalOpen()}
			onClose={() => b.setModalOpen(false)}
			title={b.editing() ? "编辑书签" : "新建书签"}
			actions={
				<>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => b.setModalOpen(false)}
						disabled={b.saving()}
					>
						取消
					</Button>
					<Button
						type="submit"
						variant="primary"
						size="sm"
						onClick={b.handleSave}
						disabled={b.saving()}
					>
						{b.saving() ? "保存中..." : "保存"}
					</Button>
				</>
			}
		>
			<form onSubmit={handleSubmit}>
				<Show when={b.formError()}>
					<div class={styles.formError}>{b.formError()}</div>
				</Show>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-title">
						标题
					</label>
					<input
						id="bookmark-title"
						class={styles.formInput}
						value={b.formTitle()}
						onInput={(e) => b.setFormTitle(e.currentTarget.value)}
						placeholder="书签名称"
						disabled={b.saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-url">
						URL
					</label>
					<input
						id="bookmark-url"
						class={styles.formInput}
						value={b.formUrl()}
						onInput={(e) => b.setFormUrl(e.currentTarget.value)}
						placeholder="https://example.com"
						disabled={b.saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<label class={styles.formLabel} for="bookmark-desc">
						备注
					</label>
					<textarea
						id="bookmark-desc"
						class={styles.formTextarea}
						value={b.formDesc()}
						onInput={(e) => b.setFormDesc(e.currentTarget.value)}
						placeholder="可选，一句话描述这个网页（可选）"
						rows={3}
						disabled={b.saving()}
					/>
				</div>
				<div class={styles.formGroup}>
					<span class={styles.formLabel}>标签</span>
					<TagInput
						tags={b.formTags()}
						onAdd={b.addFormTag}
						onRemove={b.removeFormTag}
						onTagDeleted={() => b.load({ silent: true })}
					/>
				</div>
			</form>
		</Modal>
	);
}
