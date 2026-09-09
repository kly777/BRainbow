import type { MediaItem } from "@modules/media";
import { deleteMediaE, listMediaE, renameMediaE } from "@modules/media";
import { getErrorMessage, HttpError } from "@shared/api";
import {
	notifyError,
	showConfirm,
	strParam,
	tryAsync,
	useUrlParams,
} from "@shared/utils";
import { createResource, createSignal } from "solid-js";

const VALID_TYPES = ["", "image", "video", "audio"];

export interface MediaListApi {
	mediaType: () => string;
	setMediaType: (type: string) => void;
	items: () => MediaItem[];
	loading: boolean;
	error: Error | undefined;
	refetch: () => void;
	editingId: () => string | null;
	editName: () => string;
	setEditName: (value: string) => void;
	errorMessage: () => string;
	handleDelete: (storedId: string) => Promise<void>;
	startRename: (item: MediaItem) => void;
	handleRename: () => Promise<void>;
	cancelEdit: () => void;
}

export function useMediaList(): MediaListApi {
	const params = useUrlParams({ type: strParam("") });
	const mediaType = () =>
		VALID_TYPES.includes(params.get("type")) ? params.get("type") : "";
	const setMediaType = (t: string) => params.set({ type: t });

	const [media, { refetch }] = createResource(
		() => mediaType(),
		async (mt): Promise<MediaItem[]> => {
			const result = await tryAsync(() =>
				listMediaE(mt ? { media_type: mt } : {}),
			);
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
				title: force ? "强制删除媒体" : "删除媒体",
				message: force
					? "该文件仍被内容引用，强制删除后引用处将无法显示。仍要删除吗？"
					: "确定要删除这个媒体文件吗？此操作不可撤销。",
				variant: "danger",
			});
			if (!confirmed) return;
			const result = await tryAsync(() => deleteMediaE(stored_id, force));
			if (result.ok) break;
			if (result.error instanceof HttpError && result.error.status === 409) {
				force = true;
				continue;
			}
			notifyError("删除媒体失败", getErrorMessage(result.error));
			return;
		}
		refetch();
	};

	const startRename = (item: MediaItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setErrorMessage("");
	};

	const handleRename = async () => {
		const id = editingId();
		if (!id || !editName().trim()) return;
		const result = await tryAsync(() => renameMediaE(id, editName().trim()));
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
		mediaType,
		setMediaType,
		items: () => media() ?? [],
		// getter：避免 createResource 创建瞬间 state=pending 的快照被冻结
		// 为 true，导致 AsyncView 永远骨架屏（与 useFileList 同源修复）
		get loading() {
			return media.loading;
		},
		get error() {
			return media.error;
		},
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
