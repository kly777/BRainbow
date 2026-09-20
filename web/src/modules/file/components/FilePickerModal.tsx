/**
 * 文件库选择器：从已上传的文件中挑一个插入 Markdown。
 * 与「上传后自动插入」互补——整理资料时常是先把文件传进库，
 * 之后在写卡片时再来挑。
 */

import { Button, Modal, SearchInput } from "@components/ui";
import { formatBytes } from "@shared/utils";
import {
	type Component,
	createResource,
	createSignal,
	For,
	Show,
} from "solid-js";
import type { FileItem } from "../api.ts";
import { listFiles } from "../api.ts";
import { categoryLabel } from "../lib/category.ts";
import { isRenderableImage } from "../lib/thumbnail.ts";
import styles from "./FilePickerModal.module.css";

export interface PickedFile {
	url: string;
	name: string;
	mime: string;
}

interface Props {
	isOpen: boolean;
	onClose: () => void;
	onPick: (file: PickedFile) => void;
}

const PICKER_PAGE_SIZE = 60;

const FilePickerModal: Component<Props> = (props) => {
	const [query, setQuery] = createSignal("");

	const [files] = createResource(
		() => ({ q: query(), open: props.isOpen }),
		async ({ q, open }) => {
			if (!open) return [];
			const result = await listFiles({
				page: 1,
				page_size: PICKER_PAGE_SIZE,
				...(q.trim() ? { q: q.trim() } : {}),
			});
			return result.items;
		},
	);

	const pick = (item: FileItem) => {
		props.onPick({
			url: item.url,
			name: item.original_name,
			mime: item.mime_type,
		});
		props.onClose();
	};

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title="从文件库插入">
			<div class={styles.wrap}>
				<SearchInput
					value={query()}
					onSearch={setQuery}
					placeholder="搜索文件名…"
				/>

				<Show
					when={(files() ?? []).length > 0}
					fallback={
						<p class={styles.empty}>
							{files.loading ? "加载中…" : "没有匹配的文件"}
						</p>
					}
				>
					<ul class={styles.list}>
						<For each={files()}>
							{(item) => (
								<li>
									<button
										type="button"
										class={styles.item}
										onClick={() => pick(item)}
										title={`插入「${item.original_name}」`}
									>
										<span class={styles.thumb}>
											<Show
												when={isRenderableImage(item.mime_type)}
												fallback={<span class={styles.ext}>{extOf(item)}</span>}
											>
												<img
													src={item.url}
													alt=""
													class={styles.thumbImg}
													loading="lazy"
												/>
											</Show>
										</span>
										<span class={styles.info}>
											<span class={styles.name}>{item.original_name}</span>
											<span class={styles.meta}>
												{categoryLabel(item.file_category)} ·
												{formatBytes(item.size_bytes)}
											</span>
										</span>
									</button>
								</li>
							)}
						</For>
					</ul>
				</Show>

				<div class={styles.footer}>
					<Button variant="secondary" size="sm" onClick={props.onClose}>
						取消
					</Button>
				</div>
			</div>
		</Modal>
	);
};

/** 非图片文件显示后缀（与列表卡片一致） */
function extOf(item: FileItem): string {
	const dot = item.original_name.lastIndexOf(".");
	if (dot <= 0 || dot === item.original_name.length - 1) return "FILE";
	return item.original_name
		.slice(dot + 1)
		.toUpperCase()
		.slice(0, 5);
}

export default FilePickerModal;
