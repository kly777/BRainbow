import { AsyncView, Button, FilterGroup } from "@components/ui";
import type { FileItem } from "@modules/file";
import { fileUrl } from "@modules/file";
import { formatBytes } from "@shared/utils";
import { type Component, For, Show } from "solid-js";
import styles from "./FileList.module.css";
import { useFileList } from "./hooks/useFileList.ts";

const CATEGORY_TABS = [
	{ value: "", label: "全部" },
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "audio", label: "音频" },
	{ value: "document", label: "文档" },
	{ value: "other", label: "其他" },
];

const categoryIcon = (cat: string): string => {
	switch (cat) {
		case "image":
			return "🖼️";
		case "video":
			return "🎬";
		case "audio":
			return "🎵";
		case "document":
			return "📄";
		default:
			return "📁";
	}
};

const FilePreview: Component<{ item: FileItem }> = (props) => (
	<div class={styles.preview}>
		<Show
			when={props.item.file_category === "image"}
			fallback={
				<span class={styles.iconPreview}>
					{categoryIcon(props.item.file_category)}
				</span>
			}
		>
			<a
				class={styles.previewLink}
				href={fileUrl(props.item.stored_id, props.item.original_name)}
				target="_blank"
				rel="noopener noreferrer"
			>
				<img
					src={fileUrl(props.item.stored_id, props.item.original_name)}
					alt={props.item.original_name}
					class={styles.thumb}
					loading="lazy"
				/>
			</a>
		</Show>
	</div>
);

const FileCardView: Component<{
	item: FileItem;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			<p class={styles.name} title={props.item.original_name}>
				{props.item.original_name}
			</p>
			<p class={styles.meta}>
				{props.item.file_category} · {formatBytes(props.item.size_bytes)}
			</p>
			<Show when={props.item.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>{tag}</span>}
					</For>
				</div>
			</Show>
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

const FileCardEdit: Component<{
	item: FileItem;
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
				aria-label="文件名称"
			/>
			<p class={styles.meta}>
				{props.item.file_category} · {formatBytes(props.item.size_bytes)}
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

const FileCard: Component<{
	item: FileItem;
	editing: boolean;
	editName: string;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
	onRename: () => void;
	onEditName: (value: string) => void;
	onCancelEdit: () => void;
}> = (props) => (
	<div class={styles.card}>
		<FilePreview item={props.item} />
		<Show
			when={props.editing}
			fallback={
				<FileCardView
					item={props.item}
					onStartRename={props.onStartRename}
					onDelete={props.onDelete}
				/>
			}
		>
			<FileCardEdit
				item={props.item}
				editName={props.editName}
				onEditName={props.onEditName}
				onRename={props.onRename}
				onCancelEdit={props.onCancelEdit}
			/>
		</Show>
	</div>
);

const FileListPage: Component = () => {
	const f = useFileList();

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>文件管理</h1>

			<div class={styles.filters}>
				<FilterGroup
					options={CATEGORY_TABS}
					selected={f.category()}
					onChange={f.setCategory}
				/>
			</div>

			<Show when={f.errorMessage()}>
				<p class={styles.error}>{f.errorMessage()}</p>
			</Show>

			<AsyncView
				data={f.items()}
				loading={f.loading}
				error={f.error}
				onRetry={f.refetch}
				emptyMessage="暂无文件"
			>
				{(data) => (
					<div class={styles.grid}>
						<For each={data()}>
							{(item) => (
								<FileCard
									item={item}
									editing={f.editingId() === item.stored_id}
									editName={f.editName()}
									onStartRename={f.startRename}
									onDelete={f.handleDelete}
									onRename={f.handleRename}
									onEditName={f.setEditName}
									onCancelEdit={f.cancelEdit}
								/>
							)}
						</For>
					</div>
				)}
			</AsyncView>
		</div>
	);
};

export default FileListPage;
