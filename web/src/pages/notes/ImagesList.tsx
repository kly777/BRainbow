import { Effect } from "effect";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import { deleteImage, listImages, renameImage } from "@/apis/cardApi";
import type { Image } from "@/apis/types";
import { getErrorMessage, showErrorAlert } from "@/apis/types";
import styles from "./ImagesList.module.css";

const ImagesListPage: Component = () => {
	const [images, { refetch }] = createResource(async () => {
		const result = await Effect.runPromise(listImages());
		return result.items as unknown as Image[];
	});

	const [editingId, setEditingId] = createSignal<number | null>(null);
	const [editName, setEditName] = createSignal("");
	const [error, setError] = createSignal("");

	const handleDelete = async (id: number) => {
		if (!confirm("确定要删除这张图片？")) return;
		try {
			await Effect.runPromise(deleteImage(id));
			refetch();
		} catch (err) {
			showErrorAlert(err, "删除失败");
			refetch();
		}
	};

	const startRename = (img: Image) => {
		setEditingId(img.id);
		setEditName(img.original_name);
		setError("");
	};

	const cancelRename = () => {
		setEditingId(null);
		setEditName("");
	};

	const submitRename = async () => {
		const name = editName().trim();
		if (!name) return;
		try {
			await Effect.runPromise(renameImage(editingId()!, { original_name: name }));
			setEditingId(null);
			refetch();
		} catch (err) {
			showErrorAlert(err, "重命名失败");
		}
	};

	const handleRenameKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Enter") submitRename();
		if (e.key === "Escape") cancelRename();
	};

	const copyUrl = (url: string) => {
		const full = `${window.location.origin}${url}`;
		navigator.clipboard.writeText(full).then(
			() => setError(""),
			() => setError("复制失败"),
		);
	};

	return (
		<div class={styles.container}>
			<div class={styles.toolbar}>
				<h2 class={styles.title}>图片库</h2>
				<span class={styles.count}>
					{images.loading ? "..." : images()?.length ?? 0} 张
				</span>
			</div>

			<Show when={error()}>
				<div class={styles.errorBar}>{error()}</div>
			</Show>

			<Show when={images.loading}>
				<div class={styles.loading}>加载中...</div>
			</Show>

			<Show when={images.error}>
				<div class={styles.loading}>
					加载失败{" "}
					<button type="button" class={styles.retryBtn} onClick={() => refetch()}>
						重试
					</button>
				</div>
			</Show>

			<Show when={!images.loading && !images.error && images()?.length === 0}>
				<div class={styles.empty}>还没有图片，去卡片编辑器中上传吧</div>
			</Show>

			<div class={styles.grid}>
				<For each={images()}>
					{(img) => (
						<div class={styles.card}>
							<img
								class={styles.thumb}
								src={img.url}
								alt={img.original_name}
								loading="lazy"
							/>

							<Show when={editingId() === img.id}>
								<div class={styles.renameRow}>
									<input
										type="text"
										class={styles.renameInput}
										value={editName()}
										onInput={(e) => setEditName(e.currentTarget.value)}
										onKeyDown={handleRenameKeyDown}
									/>
									<button
										type="button"
										class={styles.actionBtn}
										onClick={submitRename}
									>
										确定
									</button>
									<button
										type="button"
										class={styles.actionBtn}
										onClick={cancelRename}
									>
										取消
									</button>
								</div>
							</Show>

							<Show when={editingId() !== img.id}>
								<div class={styles.nameRow}>
									<span class={styles.name} title={img.original_name}>
										{img.original_name}
									</span>
								</div>
							</Show>

							<div class={styles.actions}>
								<button
									type="button"
									class={styles.actionBtn}
									onClick={() => copyUrl(img.url)}
								>
									复制链接
								</button>
								<button
									type="button"
									class={styles.actionBtn}
									onClick={() => startRename(img)}
								>
									重命名
								</button>
								<button
									type="button"
									class={`${styles.actionBtn} ${styles.dangerBtn}`}
									onClick={() => handleDelete(img.id)}
								>
									删除
								</button>
							</div>
						</div>
					)}
				</For>
			</div>
		</div>
	);
};

export default ImagesListPage;
