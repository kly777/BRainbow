import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import {
	type MediaItem,
	deleteMediaE,
	listMediaE,
	renameMediaE,
} from "../../apis/mediaApi.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import styles from "./MediaList.module.css";

const TABS: { label: string; value: string }[] = [
	{ label: "全部", value: "" },
	{ label: "图片", value: "image" },
	{ label: "视频", value: "video" },
	{ label: "音频", value: "audio" },
];

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MediaListPage: Component = () => {
	const [mediaType, setMediaType] = createSignal("");
	const [media, { refetch }] = createResource(
		() => mediaType(),
		async (mt): Promise<MediaItem[]> => {
			try {
				const r = await listMediaE(mt ? { media_type: mt } : {});
				return r.items;
			} catch {
				return [];
			}
		},
	);

	const [editingId, setEditingId] = createSignal<string | null>(null);
	const [editName, setEditName] = createSignal("");
	const [error, setError] = createSignal("");

	const handleDelete = async (stored_id: string) => {
		if (!confirm("确定要删除？")) return;
		try {
			await deleteMediaE(stored_id);
			refetch();
		} catch (err) {
			console.error("删除失败:", getErrorMessage(err));
			refetch();
		}
	};

	const startRename = (item: MediaItem) => {
		setEditingId(item.stored_id);
		setEditName(item.original_name);
		setError("");
	};

	const handleRename = async () => {
		const id = editingId();
		if (!id || !editName().trim()) return;
		try {
			await renameMediaE(id, editName().trim());
			setEditingId(null);
			refetch();
		} catch (err) {
			setError(getErrorMessage(err));
		}
	};

	const items = () => media() ?? [];

	return (
		<div class={styles.page}>
			<h1 class={styles.title}>媒体管理</h1>

			<nav class={styles.tabs}>
				<For each={TABS}>
					{(tab) => (
						<button
							type="button"
							class={tab.value === mediaType() ? styles.tabActive : styles.tab}
							onClick={() => setMediaType(tab.value)}
						>
							{tab.label}
						</button>
					)}
				</For>
			</nav>

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
													<button
														type="button"
														class={styles.btn}
														onClick={() => startRename(item)}
													>
														重命名
													</button>
													<button
														type="button"
														class={`${styles.btn} ${styles.btnDanger}`}
														onClick={() => handleDelete(item.stored_id)}
													>
														删除
													</button>
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
											<button
												type="button"
												class={styles.btn}
												onClick={handleRename}
											>
												保存
											</button>
											<button
												type="button"
												class={styles.btn}
												onClick={() => setEditingId(null)}
											>
												取消
											</button>
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
