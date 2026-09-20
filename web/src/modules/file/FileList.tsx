// ── /file：通用文件列表（类别筛选 + 标签筛选 + 文件名搜索 + 上传） ──

import {
	Button,
	FilterGroup,
	ListPage,
	SearchInput,
	Select,
	SimplePagination,
} from "@components/ui";
import { Grid, List, Upload, X } from "@components/ui/icons";
import { fillPath, PATHS } from "@config/paths";
import { formatBytes } from "@shared/utils";
import { useNavigate } from "@solidjs/router";
import { type Component, createSignal, For, Show } from "solid-js";
import type { FileItem, SortOrder } from "./api.ts";
import BatchBar from "./components/BatchBar.tsx";
import EmptyGuide from "./components/EmptyGuide.tsx";
import FileCard from "./components/FileCard.tsx";
import FileContextMenu from "./components/FileContextMenu.tsx";
import FileRow from "./components/FileRow.tsx";
import ImageLightbox from "./components/ImageLightbox.tsx";
import TagFilter from "./components/TagFilter.tsx";
import TagManager from "./components/TagManager.tsx";
import UploadPanel from "./components/UploadPanel.tsx";
import styles from "./FileList.module.css";
import { useFileDropZone, usePasteFiles } from "./hooks/useFileDropZone.ts";
import { useFileList } from "./hooks/useFileList.ts";
import { useImageLightbox } from "./hooks/useImageLightbox.ts";
import { useListScroll } from "./hooks/useListScroll.ts";

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

const FileListPage: Component = () => {
	const f = useFileList();
	const navigate = useNavigate();
	const openDetail = (item: FileItem) => {
		// 记录来源 URL：详情页返回时回到同一页/同一筛选（否则分页后返回总是跳第 1 页）
		navigate(fillPath(PATHS.fileDetail, item.stored_id), {
			state: { from: location.pathname + location.search },
		});
	};

	// ── 图片灯箱：在当前页的图片之间左右切换（可放大判定与卡片/列表行共用一处） ──
	const lightbox = useImageLightbox(() => f.items());
	const [tagManagerOpen, setTagManagerOpen] = createSignal(false);
	const [menu, setMenu] = createSignal<{
		item: FileItem;
		x: number;
		y: number;
	} | null>(null);
	const openContextMenu = (item: FileItem, e: MouseEvent) => {
		e.preventDefault();
		setMenu({ item, x: e.clientX, y: e.clientY });
	};

	// ── 整页拖放 / 粘贴上传（逻辑见 hooks/useFileDropZone.ts） ──
	const dropZone = useFileDropZone((files) => void f.handleUploadFiles(files));
	usePasteFiles((files) => void f.handleUploadFiles(files));

	// ── 滚动位置：离开时记住、从详情返回时恢复；上传命中时定位到该文件 ──
	const scroll = useListScroll({ items: f.items, key: SCROLL_KEY });
	scroll.trackHighlight(f.highlightId);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: 整页拖拽投放区无对应 ARIA role；键盘用户走「上传文件」按钮
		<div
			class={styles.page}
			classList={{ [styles.pageDragging]: dropZone.dragging() }}
			onDragEnter={dropZone.onDragEnter}
			onDragOver={dropZone.onDragOver}
			onDragLeave={dropZone.onDragLeave}
			onDrop={dropZone.onDrop}
		>
			<Show when={dropZone.dragging()}>
				<div class={styles.dropOverlay}>
					<div class={styles.dropHint}>松开即上传到文件库</div>
				</div>
			</Show>

			{/* 页头 / 筛选区 / 四态列表 / 分页这四段原先在页面里逐段手写（与 ListPage
			    封装的结构完全同形），现在交给外壳；DOM 顺序与类名不变 */}
			<ListPage
				title="文件"
				desc={
					f.stats()
						? `共 ${f.stats()?.total_count} 个文件 · 占用 ${formatBytes(f.stats()?.total_bytes ?? 0)}`
						: "图片、视频、音频与文档的统一存储；复制 URL 可直接嵌入 Markdown"
				}
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
							variant="ghost"
							size="sm"
							onClick={() => setTagManagerOpen(true)}
						>
							标签管理
						</Button>
						<Button
							variant={f.selectMode() ? "secondary" : "ghost"}
							size="sm"
							onClick={() => f.setSelectMode(!f.selectMode())}
						>
							{f.selectMode() ? "退出选择" : "选择"}
						</Button>
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
				filters={
					<>
						<div class={styles.filterRow}>
							<FilterGroup
								options={CATEGORY_TABS.map((tab) => {
									const stat = f
										.stats()
										?.by_category.find((c) => c.category === tab.value);
									return stat && stat.count > 0
										? { ...tab, label: `${tab.label} ${stat.count}` }
										: tab;
								})}
								selected={f.category()}
								onChange={f.setCategory}
							/>
							<div class={styles.viewToggle}>
								<button
									type="button"
									class={styles.viewBtn}
									classList={{ [styles.viewBtnActive]: f.view() === "grid" }}
									onClick={() => f.setView("grid")}
									title="网格视图"
									aria-pressed={f.view() === "grid"}
								>
									<Grid size={15} />
								</button>
								<button
									type="button"
									class={styles.viewBtn}
									classList={{ [styles.viewBtnActive]: f.view() === "list" }}
									onClick={() => f.setView("list")}
									title="列表视图"
									aria-pressed={f.view() === "list"}
								>
									<List size={15} />
								</button>
							</div>
							{/* biome-ignore lint/a11y/noLabelWithoutControl: Select 渲染的根节点就是原生 <select>，包裹式 label 已隐式关联；lint 无法跟进组件内部 */}
							<label class={styles.sortLabel}>
								<span class={styles.sortText}>排序</span>
								<Select
									class={styles.sortSelect}
									value={f.sort()}
									onChange={(e) =>
										f.setSort(e.currentTarget.value as SortOrder)
									}
									aria-label="排序方式"
								>
									<For each={SORT_OPTIONS}>
										{(option) => (
											<option value={option.value}>{option.label}</option>
										)}
									</For>
								</Select>
							</label>
						</div>

						<Show when={f.errorMessage()}>
							<p class={styles.error}>{f.errorMessage()}</p>
						</Show>
					</>
				}
				data={f.items()}
				loading={f.loading}
				loadingVariant={f.view()}
				error={f.error}
				onRetry={f.refetch}
				emptySlot={
					<EmptyGuide
						filtered={Boolean(f.category() || f.tag() || f.search())}
						onUpload={() =>
							document.getElementById("file-upload-input")?.click()
						}
					/>
				}
				footer={
					<SimplePagination
						page={f.page()}
						totalPages={f.totalPages()}
						total={f.total()}
						onPrev={() => f.goPage(f.page() - 1)}
						onNext={() => f.goPage(f.page() + 1)}
					/>
				}
			>
				{(data) => (
					<div
						classList={{
							[styles.grid]: f.view() === "grid",
							[styles.listView]: f.view() === "list",
						}}
					>
						<For each={data()}>
							{(item) => (
								<Show
									when={f.view() === "grid"}
									fallback={
										<FileRow
											item={item}
											highlighted={f.highlightId() === item.stored_id}
											selectMode={f.selectMode()}
											selected={f.selected().has(item.stored_id)}
											onToggleSelect={f.toggleSelect}
											onContextMenu={openContextMenu}
											onOpen={() => openDetail(item)}
											onZoom={() => lightbox.open(item)}
											onStartRename={f.startRename}
											onDelete={f.handleDelete}
										/>
									}
								>
									<FileCard
										item={item}
										editing={f.editingId() === item.stored_id}
										highlighted={f.highlightId() === item.stored_id}
										selectMode={f.selectMode()}
										selected={f.selected().has(item.stored_id)}
										onToggleSelect={f.toggleSelect}
										onContextMenu={openContextMenu}
										editName={f.editName()}
										onOpen={() => openDetail(item)}
										onZoom={() => lightbox.open(item)}
										onStartRename={f.startRename}
										onDelete={f.handleDelete}
										onRename={f.handleRename}
										onEditName={f.setEditName}
										onCancelEdit={f.cancelEdit}
									/>
								</Show>
							)}
						</For>
					</div>
				)}
			</ListPage>

			<UploadPanel tasks={f.uploadTasks} onClose={f.clearUploadTasks} />

			<Show when={menu()}>
				{(m) => (
					<FileContextMenu
						item={m().item}
						x={m().x}
						y={m().y}
						onClose={() => setMenu(null)}
						onOpenDetail={() => openDetail(m().item)}
						onStartRename={f.startRename}
						onDelete={f.handleDelete}
					/>
				)}
			</Show>

			<TagManager
				isOpen={tagManagerOpen()}
				onClose={() => setTagManagerOpen(false)}
				onChanged={f.refetch}
			/>

			<BatchBar
				count={f.selected().size}
				total={f.items().length}
				onSelectAll={f.selectAll}
				onClear={f.clearSelection}
				onAddTag={f.batchAddTag}
				onCopyLinks={f.batchCopyLinks}
				onDelete={f.batchDelete}
			/>

			<Show when={lightbox.index() >= 0}>
				<ImageLightbox
					items={lightbox.items()}
					index={lightbox.index()}
					onClose={lightbox.close}
					onNavigate={lightbox.navigate}
				/>
			</Show>
		</div>
	);
};

export default FileListPage;
