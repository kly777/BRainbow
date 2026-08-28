// ── /bookmark 表单弹窗（新建/编辑）──

import { Button, Modal } from "@components/ui";
import { Show } from "solid-js";
import { fillPath, PATHS } from "@config/paths";
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

	const handleUrlBlur = () => {
		const url = b.formUrl().trim();
		if (url && /^https?:\/\//i.test(url)) {
			b.checkUrl(url);
		}
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
						disabled={b.saving() || (!b.editing() && b.urlExists())}
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
					<label class={styles.formLabel} for="bookmark-url">
						URL
					</label>
					<div class={styles.urlInputRow}>
						<input
							id="bookmark-url"
							class={styles.formInput}
							value={b.formUrl()}
							onInput={(e) => b.setFormUrl(e.currentTarget.value)}
							onBlur={handleUrlBlur}
							placeholder="https://example.com"
							disabled={b.saving()}
						/>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => b.fetchTitle(b.formUrl())}
							disabled={b.fetchingTitle() || !b.formUrl().trim()}
							title="从网页抓取标题"
						>
							{b.fetchingTitle() ? "获取中..." : "获取标题"}
						</Button>
					</div>
					<Show when={b.urlChecking()}>
						<div class={styles.urlHint}>检查中...</div>
					</Show>
					<Show when={b.urlExists()}>
						<div class={styles.urlWarning}>
							⚠ 该 URL 已被收藏：
							<a
								href={fillPath(
									PATHS.bookmarkDetail,
									b.urlExistsBookmark()?.id ?? "",
								)}
								target="_blank"
								rel="noopener noreferrer"
							>
								{b.urlExistsBookmark()?.title}
							</a>
						</div>
					</Show>
				</div>
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
