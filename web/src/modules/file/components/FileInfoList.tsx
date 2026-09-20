import { AlertTriangle, Lock } from "@components/ui/icons";
import { copyTextWithToast, fmtLocal, formatBytes } from "@shared/utils";
import { For, Show } from "solid-js";
import type { FileItem } from "../api.ts";
import styles from "../FileDetail.module.css";
import { categoryLabel } from "../lib/category.ts";

/**
 * 侧栏的查看模式：可见性 / 类型 / 大小 / 尺寸 / 时间 / 内容哈希 + 标签 + 元信息。
 * （编辑模式在 FileEditForm）
 */
export default function FileInfoList(props: { item: FileItem }) {
	return (
		<>
			<Show when={props.item.missing}>
				<div class={styles.missingNotice}>
					<AlertTriangle size={16} />
					<span>内容已丢失：磁盘上找不到该文件，记录仍保留</span>
				</div>
			</Show>
			<div class={styles.infoList}>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>可见性</span>
					<span class={styles.infoValue}>
						<Show
							when={props.item.is_private}
							fallback={<span>公开（所有人可见）</span>}
						>
							<span class={styles.privateValue}>
								<Lock size={12} /> 私密（仅自己可见）
							</span>
						</Show>
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>类型</span>
					<span class={styles.infoValue}>
						{categoryLabel(props.item.file_category)} · {props.item.mime_type}
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>大小</span>
					<span class={styles.infoValue}>
						{formatBytes(props.item.size_bytes)}
					</span>
				</div>
				<Show when={props.item.width || props.item.height}>
					<div class={styles.infoItem}>
						<span class={styles.infoLabel}>尺寸</span>
						<span class={styles.infoValue}>
							{props.item.width} × {props.item.height}
						</span>
					</div>
				</Show>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>创建于</span>
					<span class={styles.infoValue}>
						{fmtLocal(props.item.created_at)}
					</span>
				</div>
				<div class={styles.infoItem}>
					<span class={styles.infoLabel}>更新于</span>
					<span class={styles.infoValue}>
						{fmtLocal(props.item.updated_at)}
					</span>
				</div>
				<Show when={props.item.content_hash}>
					{(hash) => (
						<div class={styles.infoItem}>
							<span class={styles.infoLabel}>内容 SHA-256</span>
							<button
								type="button"
								class={styles.hashValue}
								title={`${hash()}（点击复制）`}
								onClick={() => copyTextWithToast(hash())}
							>
								{hash().slice(0, 16)}…
							</button>
						</div>
					)}
				</Show>
			</div>

			<Show when={props.item.tags.length > 0}>
				<div class={styles.section}>
					<span class={styles.sectionLabel}>标签</span>
					<div class={styles.tags}>
						<For each={props.item.tags}>
							{(tag) => <span class={styles.tag}>#{tag}</span>}
						</For>
					</div>
				</div>
			</Show>

			<Show when={Object.keys(props.item.meta ?? {}).length > 0}>
				<div class={styles.section}>
					<span class={styles.sectionLabel}>元信息</span>
					<dl class={styles.metaList}>
						<For each={Object.entries(props.item.meta ?? {})}>
							{([key, value]) => (
								<div class={styles.metaRow}>
									<dt class={styles.metaKey}>{key}</dt>
									<dd class={styles.metaValue}>{value}</dd>
								</div>
							)}
						</For>
					</dl>
				</div>
			</Show>
		</>
	);
}
