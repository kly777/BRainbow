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
import {
	type Component,
	createEffect,
	createSignal,
	For,
	onCleanup,
	Show,
} from "solid-js";
import type { FileItem, SortOrder } from "./api.ts";
import { fileUrl } from "./api.ts";
import ImageLightbox from "./components/ImageLightbox.tsx";
import TagFilter from "./components/TagFilter.tsx";
import styles from "./FileList.module.css";
import { type UploadTask, useFileList } from "./hooks/useFileList.ts";
import { fileExt } from "./lib/filename.ts";

/** 列表滚动位置的 sessionStorage 键（从详情返回时恢复） */
const SCROLL_KEY = "file-list-scroll-top";

const CATEGORY_TABS = [
	{ value: "", label: "全部" },
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "audio", label: "音频" },
	{ value: "document", label: "文档" },
	{ value: "other", label: "其他" },
];

/** 排序选项（与后端 SortOrder 枚举一致） */
const SORT_OPTIONS = [
	{ value: "created_desc", label: "最新在前" },
	{ value: "created_asc", label: "最早在前" },
	{ value: "size_desc", label: "从大到小" },
	{ value: "size_asc", label: "从小到大" },
	{ value: "name_asc", label: "名称 A→Z" },
	{ value: "name_desc", label: "名称 Z→A" },
] as const;

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

const FilePreview: Component<{
	item: FileItem;
	onOpen: () => void;
	/** 图片点击打开灯箱（传 null 表示不可放大，退回 onOpen） */
	onZoom?: () => void;
}> = (props) => (
	<button
		type="button"
		class={styles.preview}
		onClick={() => {
			if (props.item.file_category === "image" && props.onZoom) props.onZoom();
			else props.onOpen();
		}}
		title={props.item.file_category === "image" ? "放大查看" : "查看详情"}
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
	onZoom?: () => void;
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
		<FilePreview
			item={props.item}
			onOpen={props.onOpen}
			onZoom={props.onZoom}
		/>
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

/** 上传进度面板：批量/大文件时显示每个文件的进度与结果 */
const UploadPanel: Component<{
	tasks: () => UploadTask[];
	onClose: () => void;
}> = (props) => {
	const percent = (loaded: number, size: number) =>
		size === 0 ? 0 : Math.min(100, Math.round((loaded / size) * 100));
	const label = (status: string) =>
		status === "done"
			? "完成"
			: status === "duplicate"
				? "已存在"
				: status === "error"
					? "失败"
					: status === "pending"
						? "排队中"
						: "上传中";

	return (
		<Show when={props.tasks().length > 0}>
			<div class={styles.uploadPanel}>
				<div class={styles.uploadPanelHead}>
					<span>上传（{props.tasks().length}）</span>
					<Button variant="icon" title="收起" onClick={props.onClose}>
						<X size={14} />
					</Button>
				</div>
				<ul class={styles.uploadList}>
					<For each={props.tasks()}>
						{(t) => (
							<li class={styles.uploadItem}>
								<div class={styles.uploadItemHead}>
									<span class={styles.uploadName} title={t.name}>
										{t.name}
									</span>
									<span class={styles.uploadStatus}>
										{label(t.status)}
										{t.status === "uploading"
											? ` ${percent(t.loaded, t.size)}%`
											: ""}
									</span>
								</div>
								<div class={styles.uploadBar}>
									<div
										classList={{
											[styles.uploadBarFill]: true,
											[styles.uploadBarDone]: t.status === "done",
											[styles.uploadBarDup]: t.status === "duplicate",
											[styles.uploadBarError]: t.status === "error",
										}}
										style={{
											width:
												t.status === "done" || t.status === "duplicate"
													? "100%"
													: `${percent(t.loaded, t.size)}%`,
										}}
									/>
								</div>
								<Show when={t.error}>
									<p class={styles.uploadError}>{t.error}</p>
								</Show>
							</li>
						)}
					</For>
				</ul>
			</div>
		</Show>
	);
};

const FileListPage: Component = () => {
	const f = useFileList();
	const navigate = useNavigate();
	const openDetail = (item: FileItem) => {
		// 记录来源 URL：详情页返回时回到同一页/同一筛选（否则分页后返回总是跳第 1 页）
		navigate(fillPath(PATHS.fileDetail, item.stored_id), {
			state: { from: location.pathname + location.search },
		});
	};

	// ── 图片灯箱：在当前页的图片之间左右切换 ──
	const imageItems = () =>
		f.items().filter((item) => item.file_category === "image");
	const [lightboxId, setLightboxId] = createSignal<string | null>(null);
	const lightboxIndex = () => {
		const id = lightboxId();
		if (!id) return -1;
		return imageItems().findIndex((item) => item.stored_id === id);
	};
	const openLightbox = (item: FileItem) => setLightboxId(item.stored_id);

	// ── 拖拽上传（整页投放） ──
	const [dragging, setDragging] = createSignal(false);
	// dragenter/dragleave 会在子元素间反复触发，用计数避免闪烁
	let dragDepth = 0;

	const onDragEnter = (e: DragEvent) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		dragDepth += 1;
		setDragging(true);
	};
	const onDragOver = (e: DragEvent) => {
		if (!e.dataTransfer?.types.includes("Files")) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";
	};
	const onDragLeave = () => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) setDragging(false);
	};
	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		dragDepth = 0;
		setDragging(false);
		const files = Array.from(e.dataTransfer?.files ?? []);
		if (files.length > 0) void f.handleUploadFiles(files);
	};

	// ── 粘贴上传（Ctrl+V 截图/文件） ──
	const onPaste = (e: ClipboardEvent) => {
		const files = Array.from(e.clipboardData?.items ?? [])
			.filter((item) => item.kind === "file")
			.map((item) => item.getAsFile())
			.filter((file): file is File => file !== null);
		if (files.length === 0) return;
		// 输入框里的粘贴交给输入框自己处理
		const target = e.target as HTMLElement | null;
		if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
		e.preventDefault();
		void f.handleUploadFiles(files);
	};
	document.addEventListener("paste", onPaste);
	onCleanup(() => document.removeEventListener("paste", onPaste));

	// ── 滚动位置：离开时保存，从详情返回时恢复一次 ──
	const scrollContainer = () =>
		document.querySelector("[data-scroll-container]") ??
		document.documentElement;

	onCleanup(() => {
		sessionStorage.setItem(SCROLL_KEY, String(scrollContainer().scrollTop));
	});

	let scrollRestored = false;
	createEffect(() => {
		// 等列表数据渲染完再恢复，否则高度不足会被截断
		if (scrollRestored || f.items().length === 0) return;
		const saved = Number(sessionStorage.getItem(SCROLL_KEY) ?? "0");
		sessionStorage.removeItem(SCROLL_KEY); // 一次性：只在紧接的返回时生效
		scrollRestored = true;
		if (saved > 0) {
			requestAnimationFrame(() => {
				scrollContainer().scrollTop = saved;
			});
		}
	});

	// 上传命中已有文件时：列表就绪后滚动定位到它
	createEffect(() => {
		const id = f.highlightId();
		if (!id) return;
		void f.items(); // 依赖列表数据，等渲染完成再定位
		const el = document.querySelector(`[data-file-id="${id}"]`);
		el?.scrollIntoView({ behavior: "smooth", block: "center" });
	});

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 整页拖拽投放区无对应 ARIA role；键盘用户走「上传文件」按钮
		<div
			class={styles.page}
			classList={{ [styles.pageDragging]: dragging() }}
			onDragEnter={onDragEnter}
			onDragOver={onDragOver}
			onDragLeave={onDragLeave}
			onDrop={onDrop}
		>
			<Show when={dragging()}>
				<div class={styles.dropOverlay}>
					<div class={styles.dropHint}>松开即上传到文件库</div>
				</div>
			</Show>

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
				multiple
				style={{ display: "none" }}
				onChange={(e) => {
					const files = Array.from(e.currentTarget.files ?? []);
					if (files.length > 0) void f.handleUploadFiles(files);
					e.currentTarget.value = "";
				}}
			/>

			<div class={styles.filterRow}>
				<FilterGroup
					options={CATEGORY_TABS}
					selected={f.category()}
					onChange={f.setCategory}
				/>
				<label class={styles.sortLabel}>
					<span class={styles.sortText}>排序</span>
					<select
						class={styles.sortSelect}
						value={f.sort()}
						onChange={(e) => f.setSort(e.currentTarget.value as SortOrder)}
						aria-label="排序方式"
					>
						<For each={SORT_OPTIONS}>
							{(option) => <option value={option.value}>{option.label}</option>}
						</For>
					</select>
				</label>
			</div>

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
									onZoom={() => openLightbox(item)}
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

			<UploadPanel tasks={f.uploadTasks} onClose={f.clearUploadTasks} />

			<Show when={lightboxIndex() >= 0}>
				<ImageLightbox
					items={imageItems()}
					index={lightboxIndex()}
					onClose={() => setLightboxId(null)}
					onNavigate={(index) => {
						const next = imageItems()[index];
						if (next) setLightboxId(next.stored_id);
					}}
				/>
			</Show>
		</div>
	);
};

export default FileListPage;
