// ── 卡片内的文件信息区：分类 · 尺寸/时长 · 大小，以及上传时间 ──
// 常驻展示（不再依赖 hover），随手就能看清文件规格

import { fmtFull, formatBytes } from "@shared/utils";
import { Show } from "solid-js";
import type { FileItem } from "../api.ts";
import { categoryLabel } from "../lib/category.ts";
import { fmtDimensions, fmtDurationMs } from "../lib/meta.ts";
import styles from "./FileMeta.module.css";

export default function FileMeta(props: { item: FileItem }) {
	return (
		<>
			<p class={styles.line}>
				{categoryLabel(props.item.file_category)}
				<span class={styles.sep}>·</span>
				{formatBytes(props.item.size_bytes)}
				<Show when={fmtDimensions(props.item.width, props.item.height)}>
					{(dims) => (
						<>
							<span class={styles.sep}>·</span>
							{dims()}
						</>
					)}
				</Show>
				<Show when={fmtDurationMs(props.item.duration_ms)}>
					{(duration) => (
						<>
							<span class={styles.sep}>·</span>
							{duration()}
						</>
					)}
				</Show>
			</p>
			<p class={styles.time}>上传于 {fmtFull(props.item.created_at)}</p>
		</>
	);
}
