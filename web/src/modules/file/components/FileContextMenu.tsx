/**
 * 文件卡片/行的右键菜单：查看详情、复制链接、下载、重命名、删除。
 * 用 Portal 渲染在鼠标位置，点击外部或 Esc 关闭。
 */

import { Copy, Download, Pencil, X } from "@components/ui/icons";
import { copyTextWithToast } from "@shared/utils";
import { type Component, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import type { FileItem } from "../api.ts";
import styles from "./FileContextMenu.module.css";

interface Props {
	item: FileItem;
	/** 鼠标位置（视口坐标） */
	x: number;
	y: number;
	onClose: () => void;
	onOpenDetail: () => void;
	onStartRename: (item: FileItem) => void;
	onDelete: (storedId: string) => void;
}

const FileContextMenu: Component<Props> = (props) => {
	const url = () => props.item.url;

	const onGlobalKey = (e: KeyboardEvent) => {
		if (e.key === "Escape") props.onClose();
	};

	onMount(() => {
		document.addEventListener("keydown", onGlobalKey);
		// 滚动或点击别处即关闭（延迟注册避免当前这次右键立刻触发 close）
		setTimeout(() => {
			document.addEventListener("click", props.onClose);
			window.addEventListener("scroll", props.onClose, true);
		}, 0);
	});
	onCleanup(() => {
		document.removeEventListener("keydown", onGlobalKey);
		document.removeEventListener("click", props.onClose);
		window.removeEventListener("scroll", props.onClose, true);
	});

	const run = (action: () => void) => {
		props.onClose();
		action();
	};

	// 贴边时向内收，避免菜单超出视口
	const left = () => Math.min(props.x, window.innerWidth - 200);
	const top = () => Math.min(props.y, window.innerHeight - 240);

	return (
		<Portal>
			<div
				class={styles.menu}
				style={{ left: `${left()}px`, top: `${top()}px` }}
				role="menu"
				aria-label="文件操作"
			>
				<button
					type="button"
					class={styles.item}
					role="menuitem"
					onClick={() => run(props.onOpenDetail)}
				>
					查看详情
				</button>
				<button
					type="button"
					class={styles.item}
					role="menuitem"
					onClick={() => run(() => copyTextWithToast(url()))}
				>
					<Copy size={14} /> 复制链接
				</button>
				<button
					type="button"
					class={styles.item}
					role="menuitem"
					onClick={() => run(() => window.open(url(), "_blank"))}
				>
					<Download size={14} /> 下载
				</button>
				<div class={styles.divider} />
				<button
					type="button"
					class={styles.item}
					role="menuitem"
					onClick={() => run(() => props.onStartRename(props.item))}
				>
					<Pencil size={14} /> 重命名
				</button>
				<button
					type="button"
					class={`${styles.item} ${styles.danger}`}
					role="menuitem"
					onClick={() => run(() => props.onDelete(props.item.stored_id))}
				>
					<X size={14} /> 删除
				</button>
			</div>
		</Portal>
	);
};

export default FileContextMenu;
