// ── /bookmark/:id：书签详情（全局搜索直达 + AI 标签建议） ──

import { Button, Toolbar } from "@components/ui";
import { getErrorMessage } from "@shared/api";
import { fmtLocal } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import styles from "./BookmarkDetail.module.css";
import TagInput from "./components/TagInput.tsx";
import {
	type BookmarkItem,
	useBookmarkDetail,
} from "./hooks/useBookmarkDetail.ts";

const BookmarkView: Component<{ bm: BookmarkItem }> = (props) => (
	<>
		<h1 class={styles.title}>{props.bm.title}</h1>
		<a
			class={styles.url}
			href={props.bm.url}
			target="_blank"
			rel="noopener noreferrer"
		>
			{props.bm.url}
		</a>
		<div class={styles.meta}>
			<span>
				创建于 {fmtLocal(props.bm.created_at)} · 更新于{" "}
				{fmtLocal(props.bm.updated_at)}
			</span>
		</div>
		<p class={styles.description}>{props.bm.description || "暂无备注"}</p>
		<div class={styles.tags}>
			{props.bm.tags.map((t) => (
				<span class={styles.tag}>#{t}</span>
			))}
		</div>
	</>
);

const EditForm: Component<{
	title: string;
	url: string;
	description: string;
	tags: string[];
	saving: boolean;
	formError: string;
	suggestLoading: boolean;
	suggestedTags: string[];
	onTitle: (value: string) => void;
	onUrl: (value: string) => void;
	onDescription: (value: string) => void;
	onAddTag: (name: string) => void;
	onRemoveTag: (name: string) => void;
	onCancel: () => void;
	onSave: () => void;
	onSuggestTags: () => void;
	onAcceptSuggestedTag: (tag: string) => void;
}> = (props) => (
	<div class={styles.form}>
		<label class={styles.label} for="bm-title">
			标题
		</label>
		<input
			id="bm-title"
			class={styles.input}
			value={props.title}
			onInput={(e) => props.onTitle(e.currentTarget.value)}
		/>
		<label class={styles.label} for="bm-url">
			URL
		</label>
		<input
			id="bm-url"
			class={styles.input}
			value={props.url}
			onInput={(e) => props.onUrl(e.currentTarget.value)}
		/>
		<label class={styles.label} for="bm-desc">
			备注
		</label>
		<textarea
			id="bm-desc"
			class={styles.textarea}
			value={props.description}
			onInput={(e) => props.onDescription(e.currentTarget.value)}
			rows={3}
		/>
		<span class={styles.label}>标签</span>
		<TagInput
			tags={props.tags}
			onAdd={props.onAddTag}
			onRemove={props.onRemoveTag}
		/>
		<div class={styles.suggestRow}>
			<Button
				variant="secondary"
				size="sm"
				onClick={props.onSuggestTags}
				disabled={props.suggestLoading}
			>
				{props.suggestLoading ? "AI 分析中..." : "🤖 AI 建议标签"}
			</Button>
		</div>
		<Show when={props.suggestedTags.length > 0}>
			<div class={styles.suggestedTags}>
				<span class={styles.suggestedLabel}>AI 建议：</span>
				<For each={props.suggestedTags}>
					{(tag) => (
						<button
							type="button"
							class={styles.suggestedTag}
							onClick={() => props.onAcceptSuggestedTag(tag)}
							title={`点击添加标签「${tag}」`}
						>
							+ {tag}
						</button>
					)}
				</For>
			</div>
		</Show>
		<Show when={props.formError}>
			<div class={styles.formError}>{props.formError}</div>
		</Show>
		<div class={styles.formActions}>
			<Button variant="secondary" size="sm" onClick={props.onCancel}>
				取消
			</Button>
			<Button
				variant="primary"
				size="sm"
				onClick={props.onSave}
				disabled={props.saving}
			>
				{props.saving ? "保存中…" : "保存"}
			</Button>
		</div>
	</div>
);

export default function BookmarkDetail() {
	const m = useBookmarkDetail();

	return (
		<div class={styles.container}>
			<Toolbar
				title={m.data()?.title}
				backLabel="书签列表"
				onBack={m.handleBack}
			>
				<Button
					variant="secondary"
					size="sm"
					onClick={m.startEdit}
					disabled={m.editing()}
				>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={m.remove}>
					删除
				</Button>
			</Toolbar>

			<Show when={m.dataError}>
				<div class={styles.error}>
					加载失败：{getErrorMessage(m.dataError)}
					<Button variant="primary" size="sm" onClick={m.refetch}>
						重试
					</Button>
				</div>
			</Show>

			<Show when={m.dataLoading}>
				<div class={styles.loading}>加载中…</div>
			</Show>

			<Show when={m.data()}>
				{(bm) => (
					<div class={styles.card}>
						<Show when={m.editing()} fallback={<BookmarkView bm={bm()} />}>
							<EditForm
								title={m.title()}
								url={m.url()}
								description={m.description()}
								tags={m.tags()}
								saving={m.saving()}
								formError={m.formError()}
								suggestLoading={m.suggestLoading()}
								suggestedTags={m.suggestedTags()}
								onTitle={m.setTitle}
								onUrl={m.setUrl}
								onDescription={m.setDescription}
								onAddTag={m.addTag}
								onRemoveTag={m.removeTag}
								onCancel={m.cancelEdit}
								onSave={m.save}
								onSuggestTags={m.suggestTags}
								onAcceptSuggestedTag={m.acceptSuggestedTag}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
