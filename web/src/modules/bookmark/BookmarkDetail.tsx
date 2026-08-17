// ── /bookmark/:id：书签详情（全局搜索直达） ──

import { Button, Toolbar } from "@components/ui";
import { PATHS } from "@config/paths";
import { getErrorMessage } from "@lib/api";
import { fmtLocal, notifySuccess, showConfirm, tryOrNotify } from "@lib/utils";
import {
	deleteBookmarkE,
	getBookmarkE,
	setBookmarkTagsE,
	updateBookmarkE,
} from "@modules/bookmark";
import { useNavigate, useParams } from "@solidjs/router";
import { type Component, createResource, createSignal, Show } from "solid-js";
import styles from "./BookmarkDetail.module.css";
import TagInput from "./components/TagInput.tsx";

type BookmarkItem = Awaited<ReturnType<typeof getBookmarkE>>;

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
	const params = useParams();
	const navigate = useNavigate();
	const id = () => Number(params.id);

	const [data, { refetch }] = createResource(id, (v) => {
		if (!Number.isInteger(v) || v < 1) throw new Error("无效的书签 ID");
		return getBookmarkE(v);
	});

	const [editing, setEditing] = createSignal(false);
	const [title, setTitle] = createSignal("");
	const [url, setUrl] = createSignal("");
	const [description, setDescription] = createSignal("");
	const [tags, setTags] = createSignal<string[]>([]);
	const [saving, setSaving] = createSignal(false);
	const [formError, setFormError] = createSignal("");

	const startEdit = () => {
		const bm = data();
		if (!bm) return;
		setTitle(bm.title);
		setUrl(bm.url);
		setDescription(bm.description);
		setTags([...bm.tags]);
		setFormError("");
		setEditing(true);
	};

	const save = async () => {
		const cleanTitle = title().trim();
		const cleanUrl = url().trim();
		if (!cleanTitle) {
			setFormError("标题不能为空");
			return;
		}
		if (!/^https?:\/\//i.test(cleanUrl)) {
			setFormError("URL 必须以 http:// 或 https:// 开头");
			return;
		}
		setSaving(true);
		setFormError("");
		const ok = await tryOrNotify(async () => {
			const updated = await updateBookmarkE(id(), {
				title: cleanTitle,
				url: cleanUrl,
				description: description().trim(),
			});
			await setBookmarkTagsE(updated.id, tags());
			return updated;
		}, "保存书签");
		setSaving(false);
		if (ok) {
			notifySuccess("书签已更新");
			setEditing(false);
			refetch();
		}
	};

	const remove = async () => {
		const bm = data();
		const confirmed = await showConfirm({
			title: "删除书签",
			message: `确定删除「${bm?.title ?? id()}」？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deleteBookmarkE(id()), "删除书签");
		if (ok) navigate(PATHS.bookmark);
	};

	return (
		<div class={styles.container}>
			<Toolbar
				title={data()?.title}
				backLabel="书签列表"
				onBack={() => navigate(PATHS.bookmark)}
			>
				<Button
					variant="secondary"
					size="sm"
					onClick={startEdit}
					disabled={editing()}
				>
					编辑
				</Button>
				<Button variant="danger" size="sm" onClick={remove}>
					删除
				</Button>
			</Toolbar>

			<Show when={data.error}>
				<div class={styles.error}>
					加载失败：{getErrorMessage(data.error)}
					<Button variant="primary" size="sm" onClick={refetch}>
						重试
					</Button>
				</div>
			</Show>

			<Show when={data.loading}>
				<div class={styles.loading}>加载中…</div>
			</Show>

			<Show when={data()}>
				{(bm) => (
					<div class={styles.card}>
						<Show when={editing()} fallback={<BookmarkView bm={bm()} />}>
							<EditForm
								title={title()}
								url={url()}
								description={description()}
								tags={tags()}
								saving={saving()}
								formError={formError()}
								onTitle={(value) => setTitle(value)}
								onUrl={(value) => setUrl(value)}
								onDescription={(value) => setDescription(value)}
								onAddTag={(name) =>
									setTags((prev) =>
										prev.includes(name) ? prev : [...prev, name],
									)
								}
								onRemoveTag={(name) =>
									setTags((prev) => prev.filter((t) => t !== name))
								}
								onCancel={() => setEditing(false)}
								onSave={save}
							/>
						</Show>
					</div>
				)}
			</Show>
		</div>
	);
}
