// ── /bookmark/:id：书签详情（全局搜索直达） ──

import { Button, Toolbar } from "@components/ui";
import { getErrorMessage } from "@shared/api";
import { fmtLocal } from "@shared/utils";
import { type Component, Show } from "solid-js";
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
	onTitle: (value: string) => void;
	onUrl: (value: string) => void;
	onDescription: (value: string) => void;
	onAddTag: (name: string) => void;
	onRemoveTag: (name: string) => void;
	onCancel: () => void;
	onSave: () => void;
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
								onTitle={m.setTitle}
								onUrl={m.setUrl}
								onDescription={m.setDescription}
								onAddTag={m.addTag}
								onRemoveTag={m.removeTag}
								onCancel={m.cancelEdit}
								onSave={m.save}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
