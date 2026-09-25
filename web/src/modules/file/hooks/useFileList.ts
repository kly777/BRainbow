import { useListResource } from "@shared/utils";
import { createResource } from "solid-js";
import type { FileItem, SortOrder } from "../api.ts";
import { type FileStats, getFileStats, listFiles } from "../api.ts";
import { useFileBatch } from "./file-list/useFileBatch.ts";
import { useFileItemOps } from "./file-list/useFileItemOps.ts";
import type { FileView } from "./file-list/useFileListParams.ts";
import { useFileListParams } from "./file-list/useFileListParams.ts";
import type { UploadTask } from "./file-list/useFileUploads.ts";
import { useFileUploads } from "./file-list/useFileUploads.ts";

/** 每页条数（卡片网格，24 与常见栅格列数对齐） */
const PAGE_SIZE = 24;

// 类型从子 hook 再导出：调用方（UploadPanel 等）本来就从这个路径取它们
export type { FileView, UploadTask };

export interface FileListApi {
	category: () => string;
	setCategory: (type: string) => void;
	tag: () => string;
	setTag: (tag: string) => void;
	search: () => string;
	setSearch: (q: string) => void;
	items: () => FileItem[];
	stats: () => FileStats | undefined;
	sort: () => SortOrder;
	setSort: (value: SortOrder) => void;
	view: () => FileView;
	setView: (value: FileView) => void;
	/** 选择模式（批量操作） */
	selectMode: () => boolean;
	setSelectMode: (value: boolean) => void;
	selected: () => ReadonlySet<string>;
	toggleSelect: (storedId: string) => void;
	selectAll: () => void;
	clearSelection: () => void;
	batchDelete: () => Promise<void>;
	batchAddTag: (tag: string) => Promise<void>;
	batchCopyLinks: () => Promise<void>;
	total: () => number;
	totalPages: () => number;
	page: () => number;
	goPage: (page: number) => void;
	loading: boolean;
	/** 列表加载错误；只透传给 AsyncView（共享原语给的是 unknown） */
	error: unknown;
	refetch: () => void;
	editingId: () => string | null;
	editName: () => string;
	setEditName: (value: string) => void;
	errorMessage: () => string;
	uploading: () => boolean;
	/** 上传队列（批量上传时逐条显示进度） */
	uploadTasks: () => UploadTask[];
	/** 刚上传时命中的已有文件 id（列表据此定位高亮） */
	highlightId: () => string | null;
	handleUploadFiles: (files: File[]) => Promise<void>;
	clearUploadTasks: () => void;
	handleDelete: (storedId: string) => Promise<void>;
	startRename: (item: FileItem) => void;
	handleRename: () => Promise<void>;
	cancelEdit: () => void;
}

/** 列表请求键：任一字段变化即重取（与 URL 参数一一对应，页码单独传） */
interface FileListKey {
	cat: string;
	t: string;
	q: string;
	s: SortOrder;
}

/**
 * 文件列表的组合入口：参数（URL）→ 取数 → 统计 → 单项/批量/上传三块能力。
 *
 * 拆分动机（doc/component-design.md §5 与迁移手册 T3）：原文件 602 行，
 * 四块职责各写各的（筛选参数、上传队列 140 行、批量操作 133 行、单项操作），
 * 改上传要在 600 行里找。现在各块独立成 hook，依赖（取数原语、patchList、
 * 参数）由这里显式传入 —— 子 hook 不 import 同级 hook 的内部状态。
 *
 * 对外 API 一字未改：调用方（FileList.tsx）看到的仍是 `FileListApi`。
 */
export function useFileList(): FileListApi {
	const params = useFileListParams();

	/**
	 * 列表资源走共享原语 `useListResource`：请求键 → 重取、loading/error 语义、
	 * 乐观 patch 与回滚都只有一处实现。
	 */
	const list = useListResource<FileListKey, FileItem>({
		key: () => ({
			cat: params.category(),
			t: params.tag(),
			q: params.search(),
			s: params.sort(),
		}),
		page: params.page,
		fetcher: (key, page) =>
			listFiles({
				page,
				page_size: PAGE_SIZE,
				sort: key.s,
				...(key.cat ? { category: key.cat } : {}),
				...(key.t ? { tag: key.t } : {}),
				...(key.q.trim() ? { q: key.q.trim() } : {}),
			}),
	});
	const files = list.resource;
	const refetch = list.refetch;

	// 统计：总量与类别分布（与列表同一 files 缓存域，写操作后一并失效）
	const [stats, { refetch: refetchStats }] = createResource<FileStats>(() =>
		getFileStats(),
	);

	/**
	 * 就地改写当前页列表（乐观更新）。
	 *
	 * 写操作一律"先改本地、再发请求、失败才 refetch 纠正"——此前是等接口回来再
	 * 整表重取，而 refetch 会让 AsyncView 回到骨架屏，删除/改名都要闪一下。
	 */
	const patchList = (
		update: (items: FileItem[]) => FileItem[],
		totalDelta = 0,
	) => {
		const current = files();
		// 还没有数据时不发明一页（与改动前一致：乐观更新只改已有列表）
		if (!current) return;
		list.patch(update, { total: Math.max(0, current.total + totalDelta) });
	};

	const itemOps = useFileItemOps({
		items: () => files()?.items ?? [],
		page: params.page,
		setPage: params.goPage,
		patchList,
		refetch,
		refetchStats,
	});

	const batch = useFileBatch({
		items: () => files()?.items ?? [],
		patchList,
		refetch,
		refetchStats,
	});

	const uploads = useFileUploads({
		refetch,
		refetchStats,
		resetFilters: params.resetFilters,
	});

	return {
		category: params.category,
		setCategory: params.setCategory,
		tag: params.tag,
		setTag: params.setTag,
		search: params.search,
		setSearch: params.setSearch,
		items: () => files()?.items ?? [],
		stats,
		sort: params.sort,
		setSort: params.setSort,
		view: params.view,
		setView: params.setView,
		selectMode: batch.selectMode,
		setSelectMode: batch.setSelectMode,
		selected: batch.selected,
		toggleSelect: batch.toggleSelect,
		selectAll: batch.selectAll,
		clearSelection: batch.clearSelection,
		batchDelete: batch.batchDelete,
		batchAddTag: batch.batchAddTag,
		batchCopyLinks: batch.batchCopyLinks,
		total: () => files()?.total ?? 0,
		totalPages: () => files()?.total_pages ?? 1,
		page: params.page,
		goPage: params.goPage,
		// getter：每次访问实时读取 createResource 状态。
		// 若写成 `loading: files.loading` 快照，createResource 创建瞬间
		// 同步触发 load（state=pending），快照被冻结为 true → AsyncView
		// 永远骨架屏、卡片永不渲染（"上传成功但列表不显示"根因）。
		get loading() {
			return files.loading;
		},
		get error() {
			return list.error();
		},
		refetch,
		editingId: itemOps.editingId,
		editName: itemOps.editName,
		setEditName: itemOps.setEditName,
		errorMessage: itemOps.errorMessage,
		uploading: uploads.uploading,
		uploadTasks: uploads.uploadTasks,
		highlightId: uploads.highlightId,
		handleUploadFiles: uploads.handleUploadFiles,
		clearUploadTasks: uploads.clearUploadTasks,
		handleDelete: itemOps.handleDelete,
		startRename: itemOps.startRename,
		handleRename: itemOps.handleRename,
		cancelEdit: itemOps.cancelEdit,
	};
}
