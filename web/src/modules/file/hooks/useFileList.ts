import type { FileItem } from "@modules/file";
import { deleteFile, listFiles, updateFile } from "@modules/file";
import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	showConfirm,
	strParam,
	tryAsync,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal } from "solid-js";

const VALID_CATEGORIES = ["", "image", "video", "audio", "document", "other"];

export interface FileListApi {
	category: () => string;
	setCategory: (type: string) => void;
	tag: () => string;
	setTag: (tag: string) => void;
	items: () => FileItem[];
	loading: boolean;
	error: Error | undefined;
	refetch: () => void;
	editingId: () => string | null;
	editName: () => string;
	setEditName: (value: string) => void;
	errorMessage: () => string;
	handleDelete: (storedId: string) => Promise<void>;
	startRename: (item: FileItem) => void;
	handleRename: () => Promise<void>;
	cancelEdit: () => void;
}

export function useFileList(): FileListApi {
	const params = useUrlParams({ category: strParam(""), tag: strParam("") });
	const category = () =>
		VALID_CATEGORIES.includes(params.get("category"))
			? params.get("category")
			: "";
	const setCategory = (t: string) => params.set({ category: t });
	const tag = () => params.get("tag") || "";
	const setTag = (t: string) => params.set({ tag: t });

	const [files, { refetch }] = createResource(
		() => ({ cat: category(), t: tag() }),
		async ({ cat, t }): Promise<FileItem[]> => {
			const query: Record<string, string> = {};
			if (cat) query.category = cat;
			if (t) query.tag = t;
			const result = await tryAsync(() => listFiles(query));
			if (result.ok) return result.value.items;
			throw result.error;
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [errorMessage, setErrorMessage] = createSignal("");

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
		items: () => files() ?? [],
		loading: files.loading,
		error: files.error,
		refetch,
		editingId,
		editName,
		setEditName,
		errorMessage,
		handleDelete,
		startRename,
		handleRename,
		cancelEdit,
	};
}
