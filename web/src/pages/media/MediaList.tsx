import { useSearchParams } from "@solidjs/router";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { getErrorMessage } from "../../apis/types/index.ts";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import Button from "../../components/ui/Button.tsx";
import FilterGroup from "../../components/ui/FilterGroup.tsx";
import {
	deleteMediaE,
	listMediaE,
	type MediaItem,
	renameMediaE,
} from "../../features/mem/mediaApi.ts";
import { showConfirm, tryOrNotify } from "../../lib/safe-action.ts";
import { notifyError } from "../../lib/notify.ts";
import { tryAsync } from "../../lib/result.ts";
import * as styles from "./MediaList.css.ts";

const TABS = [
	{ value: "", label: "全部" },
	{ value: "image", label: "图片" },
	{ value: "video", label: "视频" },
	{ value: "audio", label: "音频" },
];

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const VALID_TYPES = ["", "image", "video", "audio"];

const MediaListPage: Component = () => {
	const [searchParams, setSearchParams] = useSearchParams();
	const mediaType = () => {
		const t = searchParams.type;
		return typeof t === "string" && VALID_TYPES.includes(t) ? t : "";
	};
	const setMediaType = (t: string) => {
		setSearchParams({ type: t || undefined });
	};
	const [media, { refetch }] = createResource(
		() => mediaType(),
		async (mt): Promise<MediaItem[]> => {
			const result = await tryAsync(() =>
				listMediaE(mt ? { media_type: mt } : {}),
			);
			if (result.ok) return result.value.items;
			notifyError("加载媒体列表失败", result.error);
			return [];
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [error, setError] = createSignal("");

	const handleDelete = async (stored_id: string) => {
		const confirmed = await showConfirm({
			title: "删除媒体",
			message: "确定要删除这个媒体文件吗？此操作不可撤销。",
			variant: "danger",
		});
		if (!confirmed) return;
		await tryOrNotify(() => deleteMediaE(stored_id), "删除媒体");
		refetch();
	};

	const startRename = (item: MediaItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setError("");
	};

	const handleRename = async () => {
		const id = editingId();
		if (!id || !editName().trim()) return;
		const result = await tryAsync(() => renameMediaE(id, editName().trim()));
		if (result.ok) {
			setEditingId(null);
			refetch();
		} else {
			setError(getErrorMessage(result.error));
		}
	};

	const items = () => media() ?? [];

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>媒体管理</h1>

			<FilterGroup
				options={TABS}
				selected={mediaType()}
				onChange={setMediaType}
			/>

			<Show when={error()}>
				<p class={styles.error}>{error()}</p>
			</Show>

			<AsyncView
				data={items()}
				loading={media.loading}
				emptyMessage="暂无媒体文件"
			>
				{(data) => (
					<div class={styles.grid}>
						<For each={data}>
							{(item) => (
								<div class={styles.card}>
									<Show
										when={editingId() === item.stored_id}
										fallback={
											<>
												<div class={styles.preview}>
													<Show when={item.media_type === "image"}>
														<a
															class={styles.previewLink}
															href={item.url}
															target="_blank"
															rel="noopener noreferrer"
														>
															<img
																src={item.url}
																alt={item.original_name}
																class={styles.thumb}
																loading="lazy"
															/>
														</a>
													</Show>
													<Show when={item.media_type !== "image"}>
														<span class={styles.iconPreview}>
															{item.media_type === "video" ? "🎬" : "🎵"}
														</span>
													</Show>
												</div>
												<div class={styles.info}>
													<p class={styles.name} title={item.original_name}>
														{item.original_name}
													</p>
													<p class={styles.meta}>
														{item.media_type} · {formatSize(item.size_bytes)}
													</p>
												</div>
												<div class={styles.actions}>
													<Button
														variant="secondary"
														size="sm"
														onClick={() => startRename(item)}
													>
														重命名
													</Button>
													<Button
														variant="danger"
														size="sm"
														onClick={() => handleDelete(item.stored_id)}
													>
														删除
													</Button>
												</div>
											</>
										}
									>
										<div class={styles.editRow}>
											<input
												type="text"
												value={editName()}
												onInput={(e) => setEditName(e.currentTarget.value)}
												class={styles.editInput}
												onKeyPress={(e) => e.key === "Enter" && handleRename()}
											/>
											<Button
												variant="primary"
												size="sm"
												onClick={handleRename}
											>
												保存
											</Button>
											<Button
												variant="secondary"
												size="sm"
												onClick={() => setEditingId(null)}
											>
												取消
											</Button>
										</div>
									</Show>
								</div>
							)}
						</For>
					</div>
				)}
			</AsyncView>
		</div>
	);
};

export default MediaListPage;
