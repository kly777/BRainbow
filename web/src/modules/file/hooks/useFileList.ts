import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	notifyInfo,
	notifySuccess,
	numParam,
	showConfirm,
	strParam,
	tryAsync,
	useListResource,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal, onCleanup } from "solid-js";
import type { FileItem, SortOrder } from "../api.ts";
import {
	deleteFile,
	type FileStats,
	getFileStats,
	listFiles,
	updateFile,
	uploadFileWithProgress,
} from "../api.ts";
import { readMediaDuration } from "../lib/mediaDuration.ts";
import { validateUploadFile } from "../lib/uploadLimits.ts";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

/** 每页条数（卡片网格，24 与常见栅格列数对齐） */
const PAGE_SIZE = 24;

/** 并发上传数（批量拖入时避免打满连接） */
const UPLOAD_CONCURRENCY = 3;

/** 列表视图模式 */
export type FileView = "grid" | "list";

/** 单个文件的上传任务状态；`rejected` = 前端预校验拦下，从未发过请求 */
export interface UploadTask {
	id: number;
	name: string;
	size: number;
	loaded: number;
	status: "pending" | "uploading" | "done" | "duplicate" | "error" | "rejected";
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

export function useFileList(): FileListApi {
	const params = useUrlParams({
		category: strParam(""),
		tag: strParam(""),
		q: strParam(""),
		sort: strParam("created_desc"),
		view: strParam("grid"),
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
	const SORT_ORDERS = [
		"created_desc",
		"created_asc",
		"size_desc",
		"size_asc",
		"name_asc",
		"name_desc",
	] as const;
	const sort = (): SortOrder => {
		const value = params.get("sort");
		return (SORT_ORDERS as readonly string[]).includes(value)
			? (value as SortOrder)
			: "created_desc";
	};
	/** 排序变化回到第 1 页 */
	const setSort = (value: SortOrder) => params.set({ sort: value, page: 1 });

	/** 视图模式：网格（缩略图优先）/ 列表（信息密度优先） */
	const view = (): FileView =>
		params.get("view") === "list" ? "list" : "grid";
	const setView = (value: FileView) => params.set({ view: value });
	const setSearch = (q: string) => params.set({ q, page: 1 });

	/**
	 * 列表资源走共享原语 `useListResource`：请求键 → 重取、loading/error 语义、
	 * 乐观 patch 与回滚都只有一处实现。
	 *
	 * 这里原先手写了一份逐条对应的实现（createResource + 独立的 loadError 信号 +
	 * 空页兜底 + 自己的 patchList），文档 doc/frontend-ui-architecture.md 记过
	 * "useFileList.patchList 与 useListResource 是同一件事尚未合并"。
	 * 保留了本地别名 `files` / `refetch`，调用点语义不变。
	 */
	const list = useListResource<FileListKey, FileItem>({
		key: () => ({ cat: category(), t: tag(), q: search(), s: sort() }),
		page,
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

		// 前端先过一道：空文件与明确超限的不进队列。大文件传到一半才收到 400 意味着
		// 用户白等一次完整上传（几百 MB 可能就是几分钟），本地拦下只需一瞬。
		// 名字先按拖入顺序一次性定好，被拦下与否都不影响面板里的编号。
		const named = list.map((file, index) => ({
			file,
			name: file.name || `未命名文件 ${index + 1}`,
		}));
		const accepted: typeof named = [];
		const rejected: UploadTask[] = [];
		for (const item of named) {
			const reason = validateUploadFile(item.file);
			if (reason) {
				rejected.push({
					id: uploadTaskSeq++,
					name: item.name,
					size: item.file.size,
					loaded: 0,
					status: "rejected",
					error: reason,
				});
			} else {
				accepted.push(item);
			}
		}

		const tasks: UploadTask[] = accepted.map((item) => ({
			id: uploadTaskSeq++,
			name: item.name,
			size: item.file.size,
			loaded: 0,
			status: "pending",
		}));
		// 被拦下的也进面板（否则用户拖了文件却"什么都没发生"），只是不占并发位
		const allTasks = [...rejected, ...tasks];
		setUploadTasks((prev) => [...prev, ...allTasks]);
		setUploading(accepted.length > 0);

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
		const queue = accepted.map((item, i) => ({
			file: item.file,
			task: tasks[i],
		}));
		const workers = Array.from(
			{ length: Math.min(UPLOAD_CONCURRENCY, queue.length) },
			async () => {
				for (;;) {
					const next = queue.shift();
					if (!next) return;
					patchTask(next.task.id, { status: "uploading" });
					try {
						// 音视频先读一次时长再传：后端拿不到它（上传路径不起子进程
						// 做媒体探测），而列表/详情页的时长角标就靠这个值
						const durationMs = await readMediaDuration(next.file);
						const uploaded = await uploadFileWithProgress(next.file, {
							durationMs,
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
			const only = allTasks[0];
			const finished = uploadTasks().find((t) => t.id === only.id);
			if (finished?.status === "duplicate") {
				notifyInfo("已存在相同文件", `「${only.name}」已在文件列表中`);
			} else if (finished?.status === "done") {
				notifySuccess(`「${only.name}」上传成功`);
			} else if (finished?.status === "rejected") {
				notifyError("未上传", finished.error ?? "文件不符合上传要求");
			} else {
				notifyError("上传失败", finished?.error ?? "未知错误");
			}
		} else {
			const parts = [`成功 ${ok} 个`];
			if (duplicated > 0) parts.push(`已存在 ${duplicated} 个`);
			if (failed > 0) parts.push(`失败 ${failed} 个`);
			if (rejected.length > 0) parts.push(`未上传 ${rejected.length} 个`);
			const summary = parts.join("，");
			if (failed > 0) {
				notifyError("上传完成（有失败）", summary);
			} else if (rejected.length > 0) {
				// 一个都没传上去时说"上传完成"会被读成"传成功了"
				const title =
					ok > 0 || duplicated > 0 ? "上传完成（有未上传）" : "未上传";
				notifyError(title, summary);
			} else {
				notifySuccess("上传完成", summary);
			}
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
			refetchStats();
		}
	};

	const handleDelete = async (stored_id: string) => {
		let force = false;
		let removedLocally = false;
		for (;;) {
			const confirmed = await showConfirm({
				title: force ? "强制删除文件" : "删除文件",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: "确定要删除这个文件吗？此操作不可撤销。",
				variant: "danger",
			});
			if (!confirmed) {
				if (removedLocally) refetch(); // 取消强删 → 把乐观移除的那条放回来
				return;
			}
			if (!removedLocally) {
				// 先本地移除：卡片立刻消失，不等网络往返
				patchList(
					(items) => items.filter((item) => item.stored_id !== stored_id),
					-1,
				);
				removedLocally = true;
			}
			const result = await tryAsync(() => deleteFile(stored_id, force));
			if (result.ok) break;
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除文件失败", getErrorMessage(result.error));
			refetch(); // 回滚
			return;
		}
		refetchStats();
		// 当前页最后一条被删掉时回退一页，避免停在空白页
		if ((files()?.items.length ?? 0) === 0 && page() > 1) {
			params.set({ page: page() - 1 });
		}
	};

	// ── 多选批量操作 ──

	const [selectMode, setSelectModeSignal] = createSignal(false);
	const [selected, setSelected] = createSignal<ReadonlySet<string>>(
		new Set<string>(),
	);

	const setSelectMode = (value: boolean) => {
		setSelectModeSignal(value);
		if (!value) setSelected(new Set<string>());
	};
	const toggleSelect = (storedId: string) =>
		setSelected((prev) => {
			const next = new Set<string>(prev);
			if (next.has(storedId)) next.delete(storedId);
			else next.add(storedId);
			return next;
		});
	const selectAll = () =>
		setSelected(
			new Set<string>((files()?.items ?? []).map((item) => item.stored_id)),
		);
	const clearSelection = () => setSelected(new Set<string>());

	/** 批量删除：逐个执行（尊重引用保护，被引用的跳过并汇总） */
	const batchDelete = async () => {
		const targets = (files()?.items ?? []).filter((item) =>
			selected().has(item.stored_id),
		);
		if (targets.length === 0) return;
		const confirmed = await showConfirm({
			title: `删除 ${targets.length} 个文件`,
			message:
				"被内容引用的文件会自动跳过（需单独确认强制删除）。此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;

		// 乐观：先把选中的都从列表移除
		const selectedIds = new Set(targets.map((item) => item.stored_id));
		patchList(
			(items) => items.filter((item) => !selectedIds.has(item.stored_id)),
			-targets.length,
		);

		let ok = 0;
		let skipped = 0;
		let failed = 0;
		for (const item of targets) {
			const result = await tryAsync(() => deleteFile(item.stored_id, false));
			if (result.ok) {
				ok += 1;
			} else if (
				result.error instanceof HttpError &&
				result.error.status === 409
			) {
				skipped += 1;
			} else {
				failed += 1;
			}
		}

		const parts = [`已删除 ${ok} 个`];
		if (skipped > 0) parts.push(`被引用跳过 ${skipped} 个`);
		if (failed > 0) parts.push(`失败 ${failed} 个`);
		const summary = parts.join("，");
		if (failed > 0) notifyError("批量删除完成（有失败）", summary);
		else notifySuccess("批量删除完成", summary);

		setSelectMode(false);
		// 被引用跳过或失败的条目其实没删掉，需要拉回真值；全部成功则保持乐观结果
		if (skipped > 0 || failed > 0) refetch();
		refetchStats();
	};

	/** 批量加标签：读现有标签后追加（update 是全量替换语义） */
	const batchAddTag = async (tag: string) => {
		const name = tag.trim();
		if (!name) return;
		const targets = (files()?.items ?? []).filter((item) =>
			selected().has(item.stored_id),
		);
		if (targets.length === 0) return;

		// 乐观：先给选中项加上标签
		const selectedIds = new Set(targets.map((item) => item.stored_id));
		patchList((items) =>
			items.map((item) =>
				selectedIds.has(item.stored_id) && !item.tags.includes(name)
					? { ...item, tags: [...item.tags, name] }
					: item,
			),
		);

		let ok = 0;
		let failed = 0;
		for (const item of targets) {
			if (item.tags.includes(name)) {
				ok += 1; // 已有该标签视为成功
				continue;
			}
			const result = await tryAsync(() =>
				updateFile(item.stored_id, { tags: [...item.tags, name] }),
			);
			if (result.ok) ok += 1;
			else failed += 1;
		}

		if (failed > 0) {
			notifyError(
				"批量加标签完成（有失败）",
				`成功 ${ok} 个，失败 ${failed} 个`,
			);
		} else {
			notifySuccess("批量加标签完成", `已为 ${ok} 个文件加上「${name}」`);
		}
		setSelectMode(false);
		if (failed > 0) refetch();
	};

	/** 批量复制链接（逐行一条，方便贴进 Markdown 或清单） */
	const batchCopyLinks = async () => {
		const targets = (files()?.items ?? []).filter((item) =>
			selected().has(item.stored_id),
		);
		if (targets.length === 0) return;
		const lines = targets.map((item) => item.url);
		const result = await tryAsync(() =>
			navigator.clipboard.writeText(lines.join("\n")),
		);
		if (result.ok) notifySuccess("已复制链接", `${targets.length} 条`);
		else notifyError("复制失败", result.error);
	};

	const startRename = (item: FileItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setErrorMessage("");
	};

	const handleRename = async () => {
		const id = editingId();
		const name = editName().trim();
		if (!id || !name) return;
		// 乐观：立刻显示新名字并退出编辑态，失败再回到编辑态让用户修改
		patchList((items) =>
			items.map((item) =>
				item.stored_id === id ? { ...item, original_name: name } : item,
			),
		);
		setEditingId(null);
		const result = await tryAsync(() =>
			updateFile(id, { original_name: name }),
		);
		if (!result.ok) {
			refetch();
			setEditingId(id);
			setEditName(name);
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
		stats,
		sort,
		setSort,
		view,
		setView,
		selectMode,
		setSelectMode,
		selected,
		toggleSelect,
		selectAll,
		clearSelection,
		batchDelete,
		batchAddTag,
		batchCopyLinks,
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
			return list.error();
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
