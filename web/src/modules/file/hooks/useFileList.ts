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
import {
	deleteFile,
	listFiles,
	updateFile,
	uploadFileWithProgress,
} from "../api.ts";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

/** 每页条数（卡片网格，24 与常见栅格列数对齐） */
const PAGE_SIZE = 24;

/** 并发上传数（批量拖入时避免打满连接） */
const UPLOAD_CONCURRENCY = 3;

/** 单个文件的上传任务状态 */
export interface UploadTask {
	id: number;
	name: string;
	size: number;
	loaded: number;
	status: "pending" | "uploading" | "done" | "duplicate" | "error";
	error?: string;
}

let uploadTaskSeq = 1;

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
	const [uploadTasks, setUploadTasks] = createSignal<UploadTask[]>([]);
	const clearUploadTasks = () => setUploadTasks([]);
	const [highlightId, setHighlightId] = createSignal<string | null>(null);
	let highlightTimer: ReturnType<typeof setTimeout> | undefined;
	onCleanup(() => clearTimeout(highlightTimer));

	// ── 上传队列（支持拖拽/粘贴/多选批量） ──

	const handleUploadFiles = async (files: File[]) => {
		const list = files.filter(Boolean);
		if (list.length === 0) return;

		const tasks: UploadTask[] = list.map((file, index) => ({
			id: uploadTaskSeq++,
			name: file.name || `未命名文件 ${index + 1}`,
			size: file.size,
			loaded: 0,
			status: "pending",
		}));
		setUploadTasks((prev) => [...prev, ...tasks]);
		setUploading(true);

		const patchTask = (id: number, patch: Partial<UploadTask>) => {
			setUploadTasks((prev) =>
				prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
			);
		};

		let ok = 0;
		let duplicated = 0;
		let failed = 0;
		let firstDuplicateId: string | null = null;

		// 限并发上传：一次拖十几个文件时避免打满连接
		const queue = list.map((file, i) => ({ file, task: tasks[i] }));
		const workers = Array.from(
			{ length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
			async () => {
				for (;;) {
					const next = queue.shift();
					if (!next) return;
					patchTask(next.task.id, { status: "uploading" });
					try {
						const uploaded = await uploadFileWithProgress(next.file, {
							onProgress: ({ loaded }) => patchTask(next.task.id, { loaded }),
						});
						if (uploaded.duplicate) {
							duplicated += 1;
							firstDuplicateId ??= uploaded.stored_id;
							patchTask(next.task.id, { status: "duplicate" });
						} else {
							ok += 1;
							patchTask(next.task.id, { status: "done" });
						}
					} catch (e) {
						failed += 1;
						patchTask(next.task.id, {
							status: "error",
							error: getErrorMessage(e),
						});
					}
				}
			},
		);
		await Promise.all(workers);
		setUploading(false);

		// 汇总：单个文件沿用原来的成功提示，批量走一条汇总
		if (list.length === 1) {
			const only = tasks[0];
			const finished = uploadTasks().find((t) => t.id === only.id);
			if (finished?.status === "duplicate") {
				notifyInfo("已存在相同文件", `「${only.name}」已在文件列表中`);
			} else if (finished?.status === "done") {
				notifySuccess(`「${only.name}」上传成功`);
			} else {
				notifyError("上传失败", finished?.error ?? "未知错误");
			}
		} else {
			const parts = [`成功 ${ok} 个`];
			if (duplicated > 0) parts.push(`已存在 ${duplicated} 个`);
			if (failed > 0) parts.push(`失败 ${failed} 个`);
			const summary = parts.join("，");
			if (failed > 0) notifyError("上传完成（有失败）", summary);
			else notifySuccess("上传完成", summary);
		}

		// 命中重复的文件在列表中定位高亮（只针对单个上传，批量时会跳来跳去）
		if (list.length === 1 && firstDuplicateId) {
			setHighlightId(firstDuplicateId);
			clearTimeout(highlightTimer);
			highlightTimer = setTimeout(() => setHighlightId(null), 4000);
		}

		// 重置筛选（类别/标签/搜索）+ 回到第 1 页：否则停留在筛选条件
		// 或较后页码时，新上传的文件"看不到"（source 变化会自动 reload）
		if (ok > 0 || duplicated > 0) {
			params.set({ category: "", tag: "", q: "", page: 1 });
			refetch();
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
		uploadTasks,
		highlightId,
		handleUploadFiles,
		clearUploadTasks,
		handleDelete,
		startRename,
		handleRename,
		cancelEdit,
	};
}
