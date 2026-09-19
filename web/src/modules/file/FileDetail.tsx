// ── /file/:id：文件详情（左：文件展示主体，右：元信息侧栏） ──

import { AsyncSection, Button, DetailPage, Field, Input } from "@components/ui";
import {
	AlertTriangle,
	Copy,
	Download,
	Lock,
	Pencil,
	Plus,
	Unlock,
	X,
} from "@components/ui/icons";
import { copyTextWithToast, fmtLocal, formatBytes } from "@shared/utils";
import { type Component, createSignal, For, onCleanup, Show } from "solid-js";
import type { FileItem } from "./api.ts";
import TagInput from "./components/TagInput.tsx";
import styles from "./FileDetail.module.css";
import { type MetaEntry, useFileDetail } from "./hooks/useFileDetail.ts";
import { categoryLabel } from "./lib/category.ts";
import {
	draggedSideWidth,
	parseSideWidth,
	sideWidthKey,
} from "./lib/splitPane.ts";
import { PreviewStage } from "./viewers/PreviewStage.tsx";

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

	/**
	 * 两栏宽度：侧栏可拖拽调宽（看文档/大图时把空间让给预览），宽度记在本地。
	 * 存**像素**而不是比例 —— 侧栏里是键值对文本、字号固定，"多宽能读"是绝对量。
	 */
	const [sideWidth, setSideWidth] = createSignal(
		parseSideWidth(localStorage.getItem(sideWidthKey)),
	);
	const [dragging, setDragging] = createSignal(false);

	const onDragStart = (e: PointerEvent) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sideWidth();
		const target = e.currentTarget as HTMLElement;
		// 捕获指针：拖到分隔条外面（甚至拖出窗口）也不断线
		target.setPointerCapture(e.pointerId);
		setDragging(true);

		const onMove = (move: PointerEvent) => {
			setSideWidth(draggedSideWidth(startWidth, startX, move.clientX));
		};
		const onUp = () => {
			setDragging(false);
			target.releasePointerCapture?.(e.pointerId);
			try {
				localStorage.setItem(sideWidthKey, String(sideWidth()));
			} catch {
				// 存不了就算了：本次拖拽仍然生效
			}
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			target.removeEventListener("pointercancel", onUp);
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
		target.addEventListener("pointercancel", onUp);
		onCleanup(onUp);
	};

	// 详情页是**单个文件**的页面：没有"上一个/下一个"（`/file/:id` 是文件汇集里的一条，
	// 相邻文件之间没有语义关系，给这种按钮只会让人误以为它们相关 —— 曾经有过，已移除）。
	// 浏览一组文件回列表页，那里的灯箱翻页按当前筛选结果来，语义成立。
	//
	// 也刻意**不**绑定 ←/→ 切文件：3DGS 预览用方向键移动相机（见 viewers/splat/controls.ts），
	// 全局快捷键会和它抢事件（回归测试断言方向键不切文件：FileDetail.render.test.tsx）。

	return (
		<DetailPage
			class={styles.container}
			title={m.data()?.original_name ?? "文件详情"}
			titleHidden
			backLabel="文件列表"
			onBack={m.handleBack}
			actions={
				<>
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
			<AsyncSection
				data={m.data}
				loading={() => m.dataLoading}
				error={() => m.dataError}
				refreshing={() => m.dataRefreshing}
				onRetry={m.refetch}
				class={styles.body}
				style={`--side-width: ${sideWidth()}px`}
			>
				{(item) => (
					<>
						<section class={styles.previewPane} aria-label="文件预览">
							<PreviewStage item={item()} />
						</section>
						{/* 分隔条：拖它调整两栏宽度；键盘用户可聚焦后按左右方向键微调（一次 16px）。
						    用 <hr> 而不是 div+role：**它的隐式角色就是 separator**（ARIA 的
						    window splitter 模式），浏览器与读屏都不必我们再去声明 */}
						<hr
							class={`${styles.splitter} ${dragging() ? styles.splitterActive : ""}`}
							aria-orientation="vertical"
							aria-label="调整预览区与信息栏宽度"
							aria-valuenow={sideWidth()}
							tabIndex={0}
							onPointerDown={onDragStart}
							onKeyDown={(e) => {
								// 与鼠标语义一致：左方向键 = 把分隔条往左移（侧栏因此变宽）
								const pointerDelta =
									e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
								if (pointerDelta === 0) return;
								e.preventDefault();
								const next = draggedSideWidth(sideWidth(), 0, pointerDelta);
								setSideWidth(next);
								try {
									localStorage.setItem(sideWidthKey, String(next));
								} catch {
									// 存不了就算了：本次调整仍然生效
								}
							}}
						/>
						<aside class={styles.sidePane} aria-label="文件信息">
							<Show when={m.editing()} fallback={<FileView item={item()} />}>
								<EditForm m={m} />
							</Show>
						</aside>
					</>
				)}
			</AsyncSection>
		</DetailPage>
	);
}
