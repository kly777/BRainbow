import { AsyncView, Button, FilterGroup } from "@components/ui";
import type { MediaItem } from "@modules/media";
import { type Component, For, Show } from "solid-js";
import { useMediaList } from "./hooks/useMediaList.ts";
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
	const m = useMediaList();

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>媒体管理</h1>

			<FilterGroup
				options={TABS}
				selected={m.mediaType()}
				onChange={m.setMediaType}
			/>

			<Show when={m.errorMessage()}>
				<p class={styles.error}>{m.errorMessage()}</p>
			</Show>

			<AsyncView
				data={m.items()}
				loading={m.loading}
				error={m.error}
				onRetry={m.refetch}
				emptyMessage="暂无媒体文件"
			>
				{(data) => (
					<div class={styles.grid}>
						<For each={data()}>
							{(item) => (
								<MediaCard
									item={item}
									editing={m.editingId() === item.stored_id}
									editName={m.editName()}
									onStartRename={m.startRename}
									onDelete={m.handleDelete}
									onRename={m.handleRename}
									onEditName={m.setEditName}
									onCancelEdit={m.cancelEdit}
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
