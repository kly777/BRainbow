/**
 * 图片灯箱：列表/详情里点图放大查看。
 * 支持左右切换同批图片、ESC/点击背景关闭、下载与复制链接。
 * 刻意不用 backdrop-filter（全屏模糊合成会让弹层出现明显卡顿）。
 */

import { Button } from "@components/ui";
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	X,
} from "@components/ui/icons";
import { copyTextWithToast, formatBytes } from "@shared/utils";
import { type Component, createEffect, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import type { FileItem } from "../api.ts";
import { fileUrl } from "../api.ts";
import styles from "./ImageLightbox.module.css";

interface Props {
	/** 可浏览的图片集合（通常是当前页的图片） */
	items: FileItem[];
	/** 当前图片索引 */
	index: number;
	onClose: () => void;
	onNavigate: (index: number) => void;
}

const ImageLightbox: Component<Props> = (props) => {
	const current = () => props.items[props.index];
	const url = (item: FileItem) => fileUrl(item.stored_id, item.original_name);

	const go = (delta: number) => {
		const next = props.index + delta;
		if (next < 0 || next >= props.items.length) return;
		props.onNavigate(next);
	};

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			props.onClose();
			return;
		}
		if (e.key === "ArrowLeft") {
			e.preventDefault();
			go(-1);
		}
		if (e.key === "ArrowRight") {
			e.preventDefault();
			go(1);
		}
	};

	document.addEventListener("keydown", onKeyDown);
	onCleanup(() => document.removeEventListener("keydown", onKeyDown));

	/** 点击遮罩空白处关闭；点在图片/工具条/导航上不关闭 */
	const onOverlayClick = (e: MouseEvent) => {
		const target = e.target as HTMLElement | null;
		if (target?.closest("[data-lightbox-keep]")) return;
		props.onClose();
	};

	// 图片变化时重置滚动位置（大图超出视口时可滚动查看细节）
	let imgWrapRef!: HTMLDivElement;
	createEffect(() => {
		void props.index;
		imgWrapRef?.scrollTo({ top: 0, left: 0 });
	});

	return (
		<Portal>
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: 键盘等价操作是 Esc（见 keydown 监听） */}
			<div
				class={styles.overlay}
				role="dialog"
				aria-modal="true"
				aria-label="图片预览"
				onClick={onOverlayClick}
			>
				<div class={styles.stage} data-lightbox-keep>
					<Show when={current()}>
						{(item) => (
							<div class={styles.imgWrap} ref={imgWrapRef}>
								<img
									src={url(item())}
									alt={item().original_name}
									class={styles.img}
								/>
							</div>
						)}
					</Show>
				</div>

				<Show when={props.items.length > 1}>
					<button
						type="button"
						class={`${styles.nav} ${styles.navPrev}`}
						disabled={props.index <= 0}
						data-lightbox-keep
						onClick={() => go(-1)}
						aria-label="上一张"
					>
						<ChevronLeft size={22} />
					</button>
					<button
						type="button"
						class={`${styles.nav} ${styles.navNext}`}
						disabled={props.index >= props.items.length - 1}
						data-lightbox-keep
						onClick={() => go(1)}
						aria-label="下一张"
					>
						<ChevronRight size={22} />
					</button>
				</Show>

				<div class={styles.bar} data-lightbox-keep>
					<Show when={current()}>
						{(item) => (
							<>
								<span class={styles.name} title={item().original_name}>
									{item().original_name}
								</span>
								<span class={styles.meta}>
									{props.index + 1} / {props.items.length} ·{" "}
									{formatBytes(item().size_bytes)}
								</span>
								<Button
									variant="icon"
									title="复制文件链接"
									onClick={() => copyTextWithToast(url(item()))}
								>
									<Copy size={16} />
								</Button>
								<Button
									variant="icon"
									title="下载"
									onClick={() => window.open(url(item()), "_blank")}
								>
									<Download size={16} />
								</Button>
							</>
						)}
					</Show>
					<Button variant="icon" title="关闭（Esc）" onClick={props.onClose}>
						<X size={16} />
					</Button>
				</div>
			</div>
		</Portal>
	);
};

export default ImageLightbox;
