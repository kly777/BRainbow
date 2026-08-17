import { AsyncView, Button, FilterGroup } from "@components/ui";
import { getErrorMessage, HttpError } from "@lib/api";
import { notifyError, showConfirm, tryAsync } from "@lib/utils";
import type { MediaItem } from "@modules/media";
import { deleteMediaE, listMediaE, renameMediaE } from "@modules/media";
import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import styles from "./MediaList.module.css";

const TABS = [
	{ value: "", label: "全部" },
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "audio", label: "音频" },
];

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VALID_TYPES = ["", "image", "video", "audio"];

const MediaPreview: Component<{ item: MediaItem }> = (props) => (
	<div class={styles.preview}>
		<Show when={props.item.media_type === "image"}>
			<a
				class={styles.previewLink}
				href={props.item.url}
				target="_blank"
				rel="noopener noreferrer"
			>
				<img
					src={props.item.url}
					alt={props.item.original_name}
					class={styles.thumb}
					loading="lazy"
				/>
			</a>
		</Show>
		<Show when={props.item.media_type !== "image"}>
			<span class={styles.iconPreview}>
				{props.item.media_type === "video" ? "🎬" : "🎵"}
			</span>
		</Show>
	</div>
);

const MediaCardView: Component<{
	item: MediaItem;
	onStartRename: (item: MediaItem) => void;
	onDelete: (stored_id: string) => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			<p class={styles.name} title={props.item.original_name}>
				{props.item.original_name}
			</p>
			<p class={styles.meta}>
				{props.item.media_type} · {formatSize(props.item.size_bytes)}
			</p>
		</div>
		<div class={styles.actions}>
			<Button
				variant="secondary"
				size="sm"
				onClick={() => props.onStartRename(props.item)}
			>
				重命名
			</Button>
			<Button
				variant="danger"
				size="sm"
				onClick={() => props.onDelete(props.item.stored_id)}
			>
				删除
			</Button>
		</div>
	</>
);

const MediaCardEdit: Component<{
	item: MediaItem;
	editName: string;
	onEditName: (value: string) => void;
	onRename: () => void;
	onCancelEdit: () => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			<input
				type="text"
				value={props.editName}
				onInput={(e) => props.onEditName(e.currentTarget.value)}
				class={styles.editInput}
				onKeyPress={(e) => e.key === "Enter" && props.onRename()}
				aria-label="媒体名称"
			/>
			<p class={styles.meta}>
				{props.item.media_type} · {formatSize(props.item.size_bytes)}
			</p>
		</div>
		<div class={styles.actions}>
			<Button variant="primary" size="sm" onClick={props.onRename}>
				保存
			</Button>
			<Button variant="secondary" size="sm" onClick={props.onCancelEdit}>
				取消
			</Button>
		</div>
	</>
);

const MediaCard: Component<{
	item: MediaItem;
	editing: boolean;
	editName: string;
	onStartRename: (item: MediaItem) => void;
	onDelete: (stored_id: string) => void;
	onRename: () => void;
	onEditName: (value: string) => void;
	onCancelEdit: () => void;
}> = (props) => (
	<div class={styles.card}>
		<MediaPreview item={props.item} />
		<Show
			when={props.editing}
			fallback={
				<MediaCardView
					item={props.item}
					onStartRename={props.onStartRename}
					onDelete={props.onDelete}
				/>
			}
		>
			<MediaCardEdit
				item={props.item}
				editName={props.editName}
				onEditName={props.onEditName}
				onRename={props.onRename}
				onCancelEdit={props.onCancelEdit}
			/>
		</Show>
	</div>
);

const MediaListPage: Component = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const mediaType = () => {
		const t = searchParams.type;
		return typeof t === "string" && VALID_TYPES.includes(t) ? t : "";
	};
	const setMediaType = (t: string) => {
		setSearchParams({ type: t || undefined });
	};
	const [media, { refetch }] = createResource(
		() => mediaType(),
		async (mt): Promise<MediaItem[]> => {
			const result = await tryAsync(() =>
				listMediaE(mt ? { media_type: mt } : {}),
			);
			if (result.ok) return result.value.items;
			throw result.error;
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [error, setError] = createSignal("");

	const handleDelete = async (stored_id: string) => {
		let force = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除媒体" : "删除媒体",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: "确定要删除这个媒体文件吗？此操作不可撤销。",
				variant: "danger",
			});
			if (!confirmed) return;
			const result = await tryAsync(() => deleteMediaE(stored_id, force));
			if (result.ok) break;
			// 409：仍被引用 → 升级为强制删除确认
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除媒体失败", getErrorMessage(result.error));
			return;
		}
		refetch();
	};

	const startRename = (item: MediaItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setError("");
	};

	const handleRename = async () => {
		const id = editingId();
		if (!id || !editName().trim()) return;
		const result = await tryAsync(() => renameMediaE(id, editName().trim()));
		if (result.ok) {
			setEditingId(null);
			refetch();
		} else {
			setError(getErrorMessage(result.error));
		}
	};

	const items = () => media() ?? [];

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>媒体管理</h1>

			<FilterGroup
				options={TABS}
				selected={mediaType()}
				onChange={setMediaType}
			/>

			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>

			<AsyncView
				data={items()}
				loading={media.loading}
				error={media.error}
				onRetry={refetch}
				emptyMessage="暂无媒体文件"
			>
				{(data) => (
					<div class={styles.grid}>
						<For each={data}>
							{(item) => (
								<MediaCard
									item={item}
									editing={editingId() === item.stored_id}
									editName={editName()}
									onStartRename={startRename}
									onDelete={handleDelete}
									onRename={handleRename}
									onEditName={(value) => setEditName(value)}
									onCancelEdit={() => setEditingId(null)}
								/>
							)}
						</For>
					</div>
				)}
			</AsyncView>
		</div>
	);
};

export default MediaListPage;
