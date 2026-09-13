// ── /file/:id：文件详情（左：文件展示主体，右：元信息侧栏） ──

import {
	Button,
	DetailPage,
	ErrorRetry,
	Field,
	Input,
	LoadingSkeleton,
} from "@components/ui";
import {
	AlertTriangle,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	FileText,
	Lock,
	Pencil,
	Plus,
	Unlock,
	X,
} from "@components/ui/icons";
import { copyTextWithToast, fmtLocal, formatBytes } from "@shared/utils";
import { type Component, For, type JSX, onCleanup, Show } from "solid-js";
import type { FileItem } from "./api.ts";
import TagInput from "./components/TagInput.tsx";
import TextPreview from "./components/TextPreview.tsx";
import styles from "./FileDetail.module.css";
import { type MetaEntry, useFileDetail } from "./hooks/useFileDetail.ts";
import { usePreviewUrl } from "./hooks/usePreviewUrl.ts";
import { categoryLabel } from "./lib/category.ts";

// ── 预览（左侧主体） ──

/** 统一处理"私密文件要先换 blob"的媒体渲染：加载中给出提示，避免 401 破图 */
const PreviewMedia: Component<{
	src: string;
	isPrivate: boolean;
	children: (url: string) => JSX.Element;
}> = (props) => {
	const resolved = usePreviewUrl(
		() => props.src,
		() => props.isPrivate,
	);
	return (
		<Show
			when={resolved()}
			// keyed 不能省：切到下一个文件时 resolved 从"真值换成另一个真值"
			// （公开文件是同步替换原 URL，私密文件是换新的 blob URL），非 keyed 的 Show
			// 只在真假变化时重建子节点，于是 <img>/<video>/<iframe> 会一直停在首帧的 src 上
			// —— 页面标题、元信息都换了，只有画面不动。回归测试见 FileDetail.render.test.tsx。
			keyed
			fallback={
				<Show when={props.isPrivate}>
					<p class={styles.previewLoading}>正在加载私密文件…</p>
				</Show>
			}
		>
			{(url) => props.children(url)}
		</Show>
	);
};

const Preview: Component<{ item: FileItem }> = (props) => {
	const url = () => props.item.url;
	return (
		<div class={styles.previewStage}>
			{/* 内容已丢失：内联预览与下载都没有意义，统一给出说明 */}
			<Show
				when={!props.item.missing}
				fallback={
					<div class={styles.previewFallback}>
						<AlertTriangle size={48} class={styles.previewMissingIcon} />
						<p class={styles.previewFallbackName}>文件内容已丢失</p>
						<p class={styles.previewMissingHint}>
							数据库里仍保留这条记录，但磁盘上找不到对应文件，无法预览或下载。
							把文件放回上传目录后会自动恢复正常。
						</p>
					</div>
				}
			>
				<Show when={props.item.file_category === "image"}>
					<PreviewMedia src={url()} isPrivate={props.item.is_private}>
						{(resolvedUrl) => (
							<a
								href={resolvedUrl}
								target="_blank"
								rel="noopener noreferrer"
								class={styles.previewLink}
							>
								<img
									src={resolvedUrl}
									alt={props.item.original_name}
									class={styles.previewImg}
								/>
							</a>
						)}
					</PreviewMedia>
				</Show>
				<Show when={props.item.file_category === "video"}>
					<PreviewMedia src={url()} isPrivate={props.item.is_private}>
						{(resolvedUrl) => (
							// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
							<video src={resolvedUrl} controls class={styles.previewMedia} />
						)}
					</PreviewMedia>
				</Show>
				<Show when={props.item.file_category === "audio"}>
					<PreviewMedia src={url()} isPrivate={props.item.is_private}>
						{(resolvedUrl) => (
							// biome-ignore lint/a11y/useMediaCaption: 文件预览无字幕源
							<audio src={resolvedUrl} controls class={styles.previewAudio} />
						)}
					</PreviewMedia>
				</Show>
				<Show when={props.item.mime_type === "application/pdf"}>
					<PreviewMedia src={url()} isPrivate={props.item.is_private}>
						{(resolvedUrl) => (
							<iframe
								src={resolvedUrl}
								class={styles.previewFrame}
								title="PDF 预览"
							/>
						)}
					</PreviewMedia>
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
			</Show>
		</div>
	);
};

// ── 侧栏：查看模式 ──

const FileView: Component<{ item: FileItem }> = (props) => (
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
		<Input
			class={styles.metaEditKey}
			placeholder="键"
			value={props.entry.key}
			onInput={(e) => props.onKey(props.index, e.currentTarget.value)}
			aria-label={`元信息键 ${props.index + 1}`}
		/>
		<Input
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
			<Field label="文件名">
				<Input
					value={m.name()}
					onInput={(e) => m.setName(e.currentTarget.value)}
				/>
			</Field>
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
		<DetailPage
			class={styles.container}
			title={m.data()?.original_name ?? "文件详情"}
			titleHidden
			backLabel="文件列表"
			onBack={m.handleBack}
			actions={
				<>
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
							if (f) copyTextWithToast(f.url);
						}}
					>
						<Copy size={14} />
					</Button>
					<Button
						variant="icon"
						title="下载文件"
						onClick={() => {
							const f = m.data();
							if (f) window.open(f.url, "_blank");
						}}
					>
						<Download size={14} />
					</Button>
					<Show when={m.data()?.can_edit}>
						<Button
							variant="icon"
							title={m.data()?.is_private ? "设为公开" : "设为私密"}
							disabled={m.saving()}
							onClick={() => void m.togglePrivate()}
						>
							<Show when={m.data()?.is_private} fallback={<Unlock size={14} />}>
								<Lock size={14} />
							</Show>
						</Button>
					</Show>
					<Show when={m.data()?.can_edit}>
						<Button
							variant="secondary"
							size="sm"
							onClick={m.startEdit}
							disabled={m.editing()}
						>
							<Pencil size={14} /> 编辑
						</Button>
					</Show>
					<Show when={m.data()?.can_edit}>
						<Button variant="danger" size="sm" onClick={m.remove}>
							删除
						</Button>
					</Show>
				</>
			}
		>
			<Show when={m.dataError}>
				<ErrorRetry error={m.dataError} onRetry={m.refetch} />
			</Show>

			{/* 骨架屏只在"还没有任何数据"时出现。切换上一个/下一个时 createResource 会保留
			    上一个文件的值（dataLoading 为 true 但 data() 仍有值），若此时照样渲染骨架，
			    骨架会插在旧内容上面，把整块内容顶下去再弹回来 —— 就是"沉一下再正确渲染"。
			    切换途中改用 aria-busy + 半透明提示，布局完全不动。 */}
			<Show when={m.dataLoading && !m.data()}>
				<LoadingSkeleton />
			</Show>

			<Show when={m.data()}>
				{(item) => (
					<div
						class={styles.body}
						aria-busy={m.dataLoading ? "true" : undefined}
					>
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
		</DetailPage>
	);
}
