import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	notifySuccess,
	showConfirm,
	strParam,
	tryAsync,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal } from "solid-js";
import type { FileItem } from "../api.ts";
import { deleteFile, listFiles, updateFile, uploadFile } from "../api.ts";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

export interface FileListApi {
	category: () => string;
	setCategory: (type: string) => void;
	tag: () => string;
	setTag: (tag: string) => void;
	search: () => string;
	setSearch: (q: string) => void;
	items: () => FileItem[];
	loading: boolean;
	error: Error | undefined;
	refetch: () => void;
	editingId: () => string | null;
	editName: () => string;
	setEditName: (value: string) => void;
	errorMessage: () => string;
	uploading: () => boolean;
	handleUpload: (file: File) => Promise<void>;
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
	});
	const category = () =>
		VALID_CATEGORIES.includes(params.get("category"))
			? params.get("category")
			: "";
	const setCategory = (t: string) => params.set({ category: t });
	const tag = () => params.get("tag") || "";
	const setTag = (t: string) => params.set({ tag: t });
	const search = () => params.get("q") || "";
	const setSearch = (q: string) => params.set({ q: q });

	const [files, { refetch }] = createResource(
		() => ({ cat: category(), t: tag(), q: search() }),
		async ({ cat, t, q }): Promise<FileItem[]> => {
			const query: Record<string, string> = {};
			if (cat) query.category = cat;
			if (t) query.tag = t;
			if (q.trim()) query.q = q.trim();
			const result = await tryAsync(() => listFiles(query));
			if (result.ok) return result.value.items;
			throw result.error;
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");
	const [uploading, setUploading] = createSignal(false);

	const handleUpload = async (file: File) => {
		if (!file) return;
		setUploading(true);
		const result = await tryAsync(() => uploadFile(file));
		setUploading(false);
		if (result.ok) {
			notifySuccess(`「${result.value.original_name}」上传成功`);
			// 重置筛选（类别/标签/搜索）：否则停留在某个筛选条件下，
			// 新上传的文件可能被过滤掉而"看不到"（source 变化会自动 reload）
			params.set({ category: "", tag: "", q: "" });
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
		refetch();
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
		items: () => files() ?? [],
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
		handleUpload,
		handleDelete,
		startRename,
		handleRename,
		cancelEdit,
	};
}
