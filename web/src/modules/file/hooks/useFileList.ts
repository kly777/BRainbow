import {
	getErrorMessage,
	HttpError,
	type PaginatedResponse,
} from "@shared/api";
import {
	notifyError,
	notifyInfo,
	notifySuccess,
	numParam,
	showConfirm,
	strParam,
	tryAsync,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../api.ts";
import { deleteFile, listFiles, updateFile, uploadFile } from "../api.ts";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

/** 每页条数（卡片网格，24 与常见栅格列数对齐） */
const PAGE_SIZE = 24;

export interface FileListApi {
	category: () => string;
	setCategory: (type: string) => void;
	tag: () => string;
	setTag: (tag: string) => void;
	search: () => string;
	setSearch: (q: string) => void;
	items: () => FileItem[];
	total: () => number;
	totalPages: () => number;
	page: () => number;
	goPage: (page: number) => void;
	loading: boolean;
	error: Error | undefined;
	refetch: () => void;
	editingId: () => string | null;
	editName: () => string;
	setEditName: (value: string) => void;
	errorMessage: () => string;
	uploading: () => boolean;
	/** 刚上传时命中的已有文件 id（列表据此定位高亮） */
	highlightId: () => string | null;
	handleUpload: (file: File, force?: boolean) => Promise<void>;
	handleDelete: (storedId: string) => Promise<void>;
	startRename: (item: FileItem) => void;
	handleRename: () => Promise<void>;
	cancelEdit: () => void;
}

export function useFileList(): FileListApi {
	const params = useUrlParams({
		category: strParam(""),
		tag: strParam(""),
		q: strParam(""),
		page: numParam(1, { min: 1 }),
	});
	const category = () =>
		VALID_CATEGORIES.includes(params.get("category"))
			? params.get("category")
			: "";
	// 筛选变化一律回到第 1 页，否则可能停在一个不存在的页码上
	const setCategory = (t: string) => params.set({ category: t, page: 1 });
	const tag = () => params.get("tag") || "";
	const setTag = (t: string) => params.set({ tag: t, page: 1 });
	const search = () => params.get("q") || "";
	const page = () => params.get("page");
	const setSearch = (q: string) => params.set({ q, page: 1 });

	const [files, { refetch }] = createResource(
		() => ({ cat: category(), t: tag(), q: search(), page: page() }),
		async ({ cat, t, q, page }): Promise<PaginatedResponse<FileItem>> => {
			const result = await tryAsync(() =>
				listFiles({
					page,
					page_size: PAGE_SIZE,
					...(cat ? { category: cat } : {}),
					...(t ? { tag: t } : {}),
					...(q.trim() ? { q: q.trim() } : {}),
				}),
			);
			if (result.ok) return result.value;
			throw result.error;
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [uploading, setUploading] = createSignal(false);
	const [highlightId, setHighlightId] = createSignal<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(highlightTimer));

	const handleUpload = async (file: File, force = false) => {
		if (!file) return;
		setUploading(true);
		const result = await tryAsync(() => uploadFile(file, undefined, force));
		setUploading(false);
		if (result.ok) {
			if (result.value.duplicate) {
				// 命中已有文件：告知是哪个文件，并让列表定位到它
				notifyInfo(
					"已存在相同文件",
					`「${result.value.original_name}」已在文件列表中`,
				);
				setHighlightId(result.value.stored_id);
				clearTimeout(highlightTimer);
				highlightTimer = setTimeout(() => setHighlightId(null), 4000);
			} else {
				notifySuccess(`「${result.value.original_name}」上传成功`);
			}
			// 重置筛选（类别/标签/搜索）+ 回到第 1 页：否则停留在筛选条件
			// 或较后页码时，新上传的文件"看不到"（source 变化会自动 reload）
			params.set({ category: "", tag: "", q: "", page: 1 });
			refetch();
		} else {
			notifyError("上传失败", getErrorMessage(result.error));
		}
	};

	const handleDelete = async (stored_id: string) => {
		let force = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除文件" : "删除文件",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: "确定要删除这个文件吗？此操作不可撤销。",
				variant: "danger",
			});
			if (!confirmed) return;
			const result = await tryAsync(() => deleteFile(stored_id, force));
			if (result.ok) break;
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除文件失败", getErrorMessage(result.error));
			return;
		}
		// 当前页最后一条被删掉时回退一页，避免停在空白页
		if ((files()?.items.length ?? 0) <= 1 && page() > 1) {
			params.set({ page: page() - 1 });
		} else {
			refetch();
		}
	};

	const startRename = (item: FileItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setErrorMessage("");
	};

	const handleRename = async () => {
		const id = editingId();
		if (!id || !editName().trim()) return;
		const result = await tryAsync(() =>
			updateFile(id, { original_name: editName().trim() }),
		);
		if (result.ok) {
			setEditingId(null);
			refetch();
		} else {
			setErrorMessage(getErrorMessage(result.error));
		}
	};

	const cancelEdit = () => {
		setEditingId(null);
	};

	return {
		category,
		setCategory,
		tag,
		setTag,
		search,
		setSearch,
		items: () => files()?.items ?? [],
		total: () => files()?.total ?? 0,
		totalPages: () => files()?.total_pages ?? 1,
		page,
		goPage: (p: number) => params.set({ page: p }),
		// getter：每次访问实时读取 createResource 状态。
		// 若写成 `loading: files.loading` 快照，createResource 创建瞬间
		// 同步触发 load（state=pending），快照被冻结为 true → AsyncView
		// 永远骨架屏、卡片永不渲染（"上传成功但列表不显示"根因）。
		get loading() {
			return files.loading;
		},
		get error() {
			return files.error;
		},
		refetch,
		editingId,
		editName,
		setEditName,
		errorMessage,
		uploading,
		highlightId,
		handleUpload,
		handleDelete,
		startRename,
		handleRename,
		cancelEdit,
	};
}
