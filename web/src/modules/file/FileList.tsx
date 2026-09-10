// ── /file：通用文件列表（类别筛选 + 标签筛选 + 文件名搜索 + 上传） ──

import {
	AsyncView,
	Button,
	FilterGroup,
	PageHead,
	SearchInput,
	SimplePagination,
} from "@components/ui";
import { Copy, File as FileIcon, Upload, X } from "@components/ui/icons";
import { fillPath, PATHS } from "@config/paths";
import { copyTextWithToast, formatBytes } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { type Component, createEffect, For, Show } from "solid-js";
import type { FileItem } from "./api.ts";
import { fileUrl } from "./api.ts";
import TagFilter from "./components/TagFilter.tsx";
import styles from "./FileList.module.css";
import { useFileList } from "./hooks/useFileList.ts";
import { fileExt } from "./lib/filename.ts";

const CATEGORY_TABS = [
	{ value: "", label: "全部" },
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "audio", label: "音频" },
	{ value: "document", label: "文档" },
	{ value: "other", label: "其他" },
];

/** 非图片文件：用后缀名徽章替代通用文件图标，一眼看出类型；
 *  无后缀时回退到通用文件图标 */
const ExtBadge: Component<{ name: string }> = (props) => (
	<Show
		when={fileExt(props.name)}
		fallback={<FileIcon size={28} class={styles.iconPreview} />}
	>
		{(ext) => <span class={styles.extBadge}>{ext()}</span>}
	</Show>
);

const FilePreview: Component<{ item: FileItem; onOpen: () => void }> = (
	props,
) => (
	<button
		type="button"
		class={styles.preview}
		onClick={props.onOpen}
		title="查看详情"
	>
		<Show
			when={props.item.file_category === "image"}
			fallback={<ExtBadge name={props.item.original_name} />}
		>
			<img
				src={fileUrl(props.item.stored_id, props.item.original_name)}
				alt={props.item.original_name}
				class={styles.thumb}
				loading="lazy"
			/>
		</Show>
	</button>
);

const FileCardView: Component<{
	item: FileItem;
	onOpen: () => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
}> = (props) => (
	<>
		<div class={styles.info}>
			<button
				type="button"
				class={styles.nameBtn}
				onClick={props.onOpen}
				title="查看详情"
			>
				{props.item.original_name}
			</button>
			<p class={styles.meta}>
				{props.item.file_category} · {formatBytes(props.item.size_bytes)}
			</p>
			<Show when={props.item.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>#{tag}</span>}
					</For>
				</div>
			</Show>
		</div>
		<div class={styles.actions}>
			<Button
				variant="icon"
				title="复制文件 URL（可用于 Markdown 引用）"
				onClick={() =>
					copyTextWithToast(
						fileUrl(props.item.stored_id, props.item.original_name),
					)
				}
			>
				<Copy size={14} />
			</Button>
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
			{/* 编辑态保留标签行：与展示态内容结构一致，避免切换时卡片高度跳变 */}
			<Show when={props.item.tags.length > 0}>
				<div class={styles.tags}>
					<For each={props.item.tags}>
						{(tag) => <span class={styles.tag}>#{tag}</span>}
					</For>
				</div>
			</Show>
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
	highlighted: boolean;
	editName: string;
	onOpen: () => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (stored_id: string) => void;
	onRename: () => void;
	onEditName: (value: string) => void;
	onCancelEdit: () => void;
}> = (props) => (
	<div
		class={styles.card}
		classList={{ [styles.cardHighlight]: props.highlighted }}
		data-file-id={props.item.stored_id}
	>
		<FilePreview item={props.item} onOpen={props.onOpen} />
		<Show
			when={props.editing}
			fallback={
				<FileCardView
					item={props.item}
					onOpen={props.onOpen}
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
	const navigate = useNavigate();
	const openDetail = (item: FileItem) =>
		navigate(fillPath(PATHS.fileDetail, item.stored_id));

	// 上传命中已有文件时：列表就绪后滚动定位到它
	createEffect(() => {
		const id = f.highlightId();
		if (!id) return;
		void f.items(); // 依赖列表数据，等渲染完成再定位
		const el = document.querySelector(`[data-file-id="${id}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
	});

	return (
		<div class={styles.page}>
			<PageHead
				title="文件"
				desc="图片、视频、音频与文档的统一存储；复制 URL 可直接嵌入 Markdown"
				actions={
					<>
						<SearchInput
							value={f.search()}
							onSearch={f.setSearch}
							placeholder="搜索文件名…"
						/>
						<Show when={f.search().trim()}>
							<Button
								variant="icon"
								title="清空搜索"
								onClick={() => f.setSearch("")}
							>
								<X size={14} />
							</Button>
						</Show>
						<TagFilter value={f.tag()} onChange={f.setTag} />
						<Button
							variant="primary"
							size="sm"
							disabled={f.uploading()}
							onClick={() =>
								document.getElementById("file-upload-input")?.click()
							}
						>
							<Upload size={14} />
							{f.uploading() ? "上传中..." : "上传文件"}
						</Button>
					</>
				}
			/>
			<input
				id="file-upload-input"
				type="file"
				style={{ display: "none" }}
				onChange={(e) => {
					const file = e.currentTarget.files?.[0];
					if (file) void f.handleUpload(file);
					e.currentTarget.value = "";
				}}
			/>

			<FilterGroup
				options={CATEGORY_TABS}
				selected={f.category()}
				onChange={f.setCategory}
			/>

			<Show when={f.errorMessage()}>
				<p class={styles.error}>{f.errorMessage()}</p>
			</Show>

			<AsyncView
				data={f.items()}
				loading={f.loading}
				error={f.error}
				onRetry={f.refetch}
				emptyMessage={
					f.category() || f.tag() || f.search()
						? "当前筛选条件下没有匹配的文件"
						: "暂无文件，点击右上角「上传文件」开始"
				}
			>
				{(data) => (
					<div class={styles.grid}>
						<For each={data()}>
							{(item) => (
								<FileCard
									item={item}
									editing={f.editingId() === item.stored_id}
									highlighted={f.highlightId() === item.stored_id}
									editName={f.editName()}
									onOpen={() => openDetail(item)}
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

			<SimplePagination
				page={f.page()}
				totalPages={f.totalPages()}
				total={f.total()}
				onPrev={() => f.goPage(f.page() - 1)}
				onNext={() => f.goPage(f.page() + 1)}
			/>
		</div>
	);
};

export default FileListPage;
