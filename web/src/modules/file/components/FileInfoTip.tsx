// ── 文件名悬浮信息卡：hover 文件名时展示完整名称与关键元信息 ──
// 列表里文件名是单行截断的，这里给出完整名称 + 类型 / 大小 / 尺寸 / 标签 / 时间

import { fmtFull, formatBytes } from "@shared/utils";
import { Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { categoryLabel } from "../lib/category.ts";
import styles from "./FileInfoTip.module.css";

/** 毫秒 → "3:21" / "1:02:03" */
export function fmtDuration(ms: number): string {
	const total = Math.round(ms / 1000);
	const seconds = String(total % 60).padStart(2, "0");
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	if (hours > 0)
		return `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`;
	return `${minutes}:${seconds}`;
}

export default function FileInfoTip(props: { item: FileItem }) {
	/** 图片 / 视频的像素尺寸 */
	const dims = () => {
		const { width, height } = props.item;
		return width && height ? `${width} × ${height}` : null;
	};
	const duration = () => {
		const ms = props.item.duration_ms;
		return ms && ms > 0 ? fmtDuration(ms) : null;
	};

	return (
		<div class={styles.card}>
			<p class={styles.name}>{props.item.original_name}</p>
			<p class={styles.line}>
				{categoryLabel(props.item.file_category)}
				<span class={styles.sep}>·</span>
				{props.item.mime_type}
			</p>
			<p class={styles.line}>
				{formatBytes(props.item.size_bytes)}
				<Show when={dims()}>
					{(d) => (
						<>
							<span class={styles.sep}>·</span>
							{d()}
						</>
					)}
				</Show>
				<Show when={duration()}>
					{(d) => (
						<>
							<span class={styles.sep}>·</span>
							时长 {d()}
						</>
					)}
				</Show>
			</p>
			<Show when={props.item.tags.length > 0}>
				<p class={styles.tags}>
					{props.item.tags.map((tag) => `#${tag}`).join(" ")}
				</p>
			</Show>
			<p class={styles.time}>上传于 {fmtFull(props.item.created_at)}</p>
		</div>
	);
}
