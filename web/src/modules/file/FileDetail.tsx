// ── /file/:id：文件详情（左：文件展示主体，右：元信息侧栏） ──

import { Button, ErrorRetry, LoadingSkeleton, Toolbar } from "@components/ui";
import {
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FileText,
	Pencil,
	Plus,
	X,
} from "@components/ui/icons";
import { copyTextWithToast, fmtLocal, formatBytes } from "@shared/utils";
import { type Component, For, onCleanup, Show } from "solid-js";
import type { FileItem } from "./api.ts";
import { fileUrl } from "./api.ts";
import TagInput from "./components/TagInput.tsx";
import TextPreview from "./components/TextPreview.tsx";
import styles from "./FileDetail.module.css";
import { type MetaEntry, useFileDetail } from "./hooks/useFileDetail.ts";
import { categoryLabel } from "./lib/category.ts";

// ── 预览（左侧主体） ──

const Preview: Component<{ item: FileItem }> = (props) => {
	const url = () => fileUrl(props.item.stored_id, props.item.original_name);
	return (
		<div class={styles.previewStage}>
			<Show when={props.item.file_category === "image"}>
				<a
					href={url()}
					target="_blank"
					rel="noopener noreferrer"
					class={styles.previewLink}
				>
					<img
						src={url()}
						alt={props.item.original_name}
						class={styles.previewImg}
					/>
				</a>
			</Show>
			<Show when={props.item.file_category === "video"}>
				{/* biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源 */}
				<video src={url()} controls class={styles.previewMedia} />
			</Show>
			<Show when={props.item.file_category === "audio"}>
				{/* biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源 */}
				<audio src={url()} controls class={styles.previewAudio} />
			</Show>
			<Show when={props.item.mime_type === "application/pdf"}>
				<iframe src={url()} class={styles.previewFrame} title="PDF 预览" />
			</Show>
			{/* 文本类预览：后端已把可识别的文本（含按扩展名兜底的源码/配置）
			    统一存为 text/*，前端只看 mime */}
			<Show when={props.item.mime_type.startsWith("text/")}>
				<div class={styles.textPaneWrap}>
					<TextPreview item={props.item} />
				</div>
			</Show>
			<Show
				when={
					props.item.file_category !== "image" &&
					props.item.file_category !== "video" &&
					props.item.file_category !== "audio" &&
					props.item.mime_type !== "application/pdf" &&
					!props.item.mime_type.startsWith("text/")
				}
			>
				<div class={styles.previewFallback}>
					<FileText size={48} class={styles.previewFallbackIcon} />
					<p class={styles.previewFallbackName}>{props.item.original_name}</p>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => window.open(url(), "_blank")}
					>
						<Download size={14} /> 下载
					</Button>
				</div>
			</Show>
		</div>
	);
};

// ── 侧栏：查看模式 ──

const FileView: Component<{ item: FileItem }> = (props) => (
	<>
		<div class={styles.infoList}>
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
				<span class={styles.infoValue}>{fmtLocal(props.item.created_at)}</span>
			</div>
			<div class={styles.infoItem}>
				<span class={styles.infoLabel}>更新于</span>
				<span class={styles.infoValue}>{fmtLocal(props.item.updated_at)}</span>
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

// ── 侧栏：编辑模式 ──

const MetaRowEditor: Component<{
	entry: MetaEntry;
	index: number;
	onKey: (index: number, value: string) => void;
	onValue: (index: number, value: string) => void;
	onRemove: (index: number) => void;
}> = (props) => (
	<div class={styles.metaEditRow}>
		<input
			type="text"
			class={styles.metaEditKey}
			placeholder="键"
			value={props.entry.key}
			onInput={(e) => props.onKey(props.index, e.currentTarget.value)}
			aria-label={`元信息键 ${props.index + 1}`}
		/>
		<input
			type="text"
			class={styles.metaEditValue}
			placeholder="值"
			value={props.entry.value}
			onInput={(e) => props.onValue(props.index, e.currentTarget.value)}
			aria-label={`元信息值 ${props.index + 1}`}
		/>
		<Button
			variant="icon"
			title="删除该行"
			onClick={() => props.onRemove(props.index)}
		>
			<X size={14} />
		</Button>
	</div>
);

const EditForm: Component<{ m: ReturnType<typeof useFileDetail> }> = (
	props,
) => {
	const m = props.m;
	return (
		<div class={styles.form}>
			<label class={styles.label} for="file-name">
				文件名
			</label>
			<input
				id="file-name"
				class={styles.input}
				value={m.name()}
				onInput={(e) => m.setName(e.currentTarget.value)}
			/>
			<span class={styles.label}>标签</span>
			<TagInput tags={m.tags()} onAdd={m.addTag} onRemove={m.removeTag} />
			<span class={styles.label}>元信息</span>
			<For each={m.metaEntries()}>
				{(entry, index) => (
					<MetaRowEditor
						entry={entry}
						index={index()}
						onKey={m.setMetaKey}
						onValue={m.setMetaValue}
						onRemove={m.removeMetaEntry}
					/>
				)}
			</For>
			<Button variant="secondary" size="sm" onClick={m.addMetaEntry}>
				<Plus size={14} /> 添加字段
			</Button>
			<Show when={m.formError()}>
				<div class={styles.formError}>{m.formError()}</div>
			</Show>
			<div class={styles.formActions}>
				<Button variant="secondary" size="sm" onClick={m.cancelEdit}>
					取消
				</Button>
				<Button
					variant="primary"
					size="sm"
					onClick={m.save}
					disabled={m.saving()}
				>
					{m.saving() ? "保存中…" : "保存"}
				</Button>
			</div>
		</div>
	);
};

// ── 页面 ──

export default function FileDetail() {
	const m = useFileDetail();

	// ← → 在同批文件间切换；输入框/文本域聚焦时不劫持方向键
	const onKeyDown = (e: KeyboardEvent) => {
		const tag = (e.target as HTMLElement | null)?.tagName;
		if (tag === "INPUT" || tag === "TEXTAREA") return;
		if (e.key === "ArrowLeft" && m.hasPrev()) {
			e.preventDefault();
			m.goPrev();
		}
		if (e.key === "ArrowRight" && m.hasNext()) {
			e.preventDefault();
			m.goNext();
		}
	};
	document.addEventListener("keydown", onKeyDown);
	onCleanup(() => document.removeEventListener("keydown", onKeyDown));

	return (
		<div class={styles.container}>
			<Toolbar
				title={m.data()?.original_name}
				backLabel="文件列表"
				onBack={m.handleBack}
			>
				<Show when={m.siblingCount() > 1}>
					<Button
						variant="icon"
						title="上一个（←）"
						disabled={!m.hasPrev()}
						onClick={m.goPrev}
					>
						<ChevronLeft size={16} />
					</Button>
					<span class={styles.siblingPos}>
						{m.siblingPosition()} / {m.siblingCount()}
					</span>
					<Button
						variant="icon"
						title="下一个（→）"
						disabled={!m.hasNext()}
						onClick={m.goNext}
					>
						<ChevronRight size={16} />
					</Button>
				</Show>
				<Button
					variant="icon"
					title="复制文件 URL（可用于 Markdown 引用）"
					onClick={() => {
						const f = m.data();
						if (f) copyTextWithToast(fileUrl(f.stored_id, f.original_name));
					}}
				>
					<Copy size={14} />
				</Button>
				<Button
					variant="icon"
					title="下载文件"
					onClick={() => {
						const f = m.data();
						if (f) window.open(fileUrl(f.stored_id, f.original_name), "_blank");
					}}
				>
					<Download size={14} />
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={m.startEdit}
					disabled={m.editing()}
				>
					<Pencil size={14} /> 编辑
				</Button>
				<Button variant="danger" size="sm" onClick={m.remove}>
					删除
				</Button>
			</Toolbar>

			<Show when={m.dataError}>
				<ErrorRetry error={m.dataError} onRetry={m.refetch} />
			</Show>

			<Show when={m.dataLoading}>
				<LoadingSkeleton />
			</Show>

			<Show when={m.data()}>
				{(item) => (
					<div class={styles.body}>
						<section class={styles.previewPane} aria-label="文件预览">
							<Preview item={item()} />
						</section>
						<aside class={styles.sidePane} aria-label="文件信息">
							<Show when={m.editing()} fallback={<FileView item={item()} />}>
								<EditForm m={m} />
							</Show>
						</aside>
					</div>
				)}
			</Show>
		</div>
	);
}
