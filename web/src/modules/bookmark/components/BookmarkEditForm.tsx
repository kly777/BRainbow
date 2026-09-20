import { Button, Input, Textarea } from "@components/ui";
import { Sparkles } from "@components/ui/icons";
import { For, Show } from "solid-js";
import styles from "../BookmarkDetail.module.css";
import type { useBookmarkDetail } from "../hooks/useBookmarkDetail.ts";
import TagInput from "./TagInput.tsx";

/**
 * 书签详情的编辑态：标题 / URL / 备注 / 标签 + AI 建议标签 + 保存取消。
 *
 * 整个 hook 作为 prop 传进来（原先把 17 个字段逐个摊成 props，调用点再逐个搬运
 * `m.*`）：表单字段与 hook 的编辑态一一对应，摊开会退化成两处都要维护的长参数表
 * —— 与 file 的 FileEditForm 同一写法。
 */
export default function BookmarkEditForm(props: {
	m: ReturnType<typeof useBookmarkDetail>;
}) {
	const m = props.m;
	return (
		<div class={styles.form}>
			{/* 编辑态替换掉了 BookmarkView 的 h1，这里补一个仅供读屏器的 h1 */}
			<h1 class="sr-only">编辑书签</h1>
			<label class={styles.label} for="bm-title">
				标题
			</label>
			<Input
				id="bm-title"
				class={styles.input}
				value={m.title()}
				onInput={(e) => m.setTitle(e.currentTarget.value)}
			/>
			<label class={styles.label} for="bm-url">
				URL
			</label>
			<Input
				id="bm-url"
				class={styles.input}
				value={m.url()}
				onInput={(e) => m.setUrl(e.currentTarget.value)}
			/>
			<label class={styles.label} for="bm-desc">
				备注
			</label>
			<Textarea
				id="bm-desc"
				class={styles.textarea}
				value={m.description()}
				onInput={(e) => m.setDescription(e.currentTarget.value)}
				rows={3}
			/>
			<span class={styles.label}>标签</span>
			<TagInput tags={m.tags()} onAdd={m.addTag} onRemove={m.removeTag} />
			<div class={styles.suggestRow}>
				<Button
					variant="secondary"
					size="sm"
					onClick={m.suggestTags}
					disabled={m.suggestLoading()}
				>
					{m.suggestLoading() ? (
						"AI 分析中..."
					) : (
						<>
							<Sparkles size={14} /> AI 建议标签
						</>
					)}
				</Button>
			</div>
			<Show when={m.suggestedTags().length > 0}>
				<div class={styles.suggestedTags}>
					<span class={styles.suggestedLabel}>AI 建议：</span>
					<For each={m.suggestedTags()}>
						{(tag) => (
							<button
								type="button"
								class={styles.suggestedTag}
								onClick={() => m.acceptSuggestedTag(tag)}
								title={`点击添加标签「${tag}」`}
							>
								+ {tag}
							</button>
						)}
					</For>
				</div>
			</Show>
			<Show when={m.formError()}>
				<div class={styles.formError}>{m.formError()}</div>
			</Show>
			<div class={styles.formActions}>
				<Button variant="secondary" size="sm" onClick={m.cancelEdit}>
					取消
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={m.save}
					disabled={m.saving()}
				>
					{m.saving() ? "保存中…" : "保存"}
				</Button>
			</div>
		</div>
	);
}
