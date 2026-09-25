import { Markdown as MarkdownRenderer } from "@components/ui";
import { createSignal, type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import styles from "./markdown-editor.module.css";

/** 插入编辑器所需的最小文件信息（上传结果与文件库挑选结果同一形状） */
export interface MarkdownFileRef {
	url: string;
	name: string;
	mime: string;
}

interface MarkdownEditorProps {
	value: string;
	onInput: (value: string) => void;
	/**
	 * 上传文件并返回可插入 Markdown 的引用。
	 * 不注入则编辑器不处理粘贴/拖入的文件（工具栏也不出现相应提示）。
	 * file 模块的实现见 `@modules/file/markdown-editor-support.tsx`。
	 */
	onUploadFile?: (file: File) => Promise<MarkdownFileRef>;
	/**
	 * "插入文件"挑选器的渲染函数——由使用方注入 file 模块的实现。
	 * 不注入则不显示该按钮（编辑器本身不认识任何业务模块）。
	 */
	filePicker?: (props: {
		isOpen: boolean;
		onClose: () => void;
		onPick: (file: MarkdownFileRef) => void;
	}) => JSX.Element;
	preview?: boolean;
	rows?: number;
	placeholder?: string;
	class?: string;
	editorClass?: string;
	id?: string;
}

/**
 * 生成插入编辑器的 Markdown 引用：图片用 `![]()`，其他文件用 `[]()` 链接。
 * 抽成纯函数便于回归测试（此前编辑器上传路径无任何测试覆盖，
 * 调用已删除模块的 404 直到手动使用才暴露）。
 */
export function buildMarkdownRef(
	mime: string,
	url: string,
	name: string,
): string {
	return mime.startsWith("image/") ? `![](${url})` : `[${name}](${url})`;
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
	let textareaRef!: HTMLTextAreaElement;
	const [dragover, setDragover] = createSignal(false);
	const [pickerOpen, setPickerOpen] = createSignal(false);

	// ── 光标位置辅助 ──

	const insertAtCursor = (insertion: string) => {
		const ta = textareaRef;
		const start = ta.selectionStart;
		const end = ta.selectionEnd;
		const before = props.value.slice(0, start);
		const after = props.value.slice(end);
		props.onInput(before + insertion + after);
		setTimeout(() => {
			ta.focus();
			const pos = start + insertion.length;
			ta.setSelectionRange(pos, pos);
		}, 0);
	};

	// ── 上传并插入 ──

	/** 上传单个文件并在光标处插入 Markdown（图片用 ![]()，其他文件用 []() 链接） */
	const uploadAndInsert = async (file: File) => {
		const upload = props.onUploadFile;
		if (!upload) return;
		const uploaded = await upload(file);
		insertAtCursor(
			`${buildMarkdownRef(uploaded.mime, uploaded.url, uploaded.name)}\n`,
		);
	};

	/** 从文件库挑选后插入（与上传插入同一套 Markdown 格式） */
	const onPicked = (file: MarkdownFileRef) => {
		insertAtCursor(`${buildMarkdownRef(file.mime, file.url, file.name)}\n`);
	};

	// ── 粘贴增强 ──

	const onPaste = async (e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		// 粘贴板里的文件（截图、复制的文件）：上传后插入引用
		for (const item of items) {
			if (item.kind !== "file") continue;
			const file = item.getAsFile();
			if (!file) continue;
			if (!props.onUploadFile) return;
			e.preventDefault();
			try {
				await uploadAndInsert(file);
			} catch {
				/* 全局 toast 已处理 */
			}
			return;
		}

		const text = e.clipboardData?.getData("text/plain");
		if (text && /^https?:\/\//.test(text.trim())) {
			const ta = textareaRef;
			if (ta.selectionStart !== ta.selectionEnd) {
				e.preventDefault();
				const selected = props.value.slice(ta.selectionStart, ta.selectionEnd);
				insertAtCursor(`[${selected}](${text.trim()})`);
			}
		}
	};

	// ── 拖拽上传 ──

	const onDragOver = (e: DragEvent) => {
		e.preventDefault();
		setDragover(true);
	};

	const onDragLeave = () => setDragover(false);

	const onDrop = async (e: DragEvent) => {
		e.preventDefault();
		setDragover(false);
		const files = e.dataTransfer?.files;
		if (!files || !props.onUploadFile) return;

		for (const file of files) {
			try {
				await uploadAndInsert(file);
			} catch {
				/* 全局 toast 已处理 */
			}
		}
	};

	// ── 输入 ──

	const autoResize = (ta: HTMLTextAreaElement) => {
		ta.style.height = "auto";
		ta.style.height = `${ta.scrollHeight}px`;
	};

	const onInput = (e: Event) => {
		const ta = e.target as HTMLTextAreaElement;
		autoResize(ta);
		props.onInput(ta.value);
	};

	// 初始自动高度
	queueMicrotask(() => {
		if (textareaRef) autoResize(textareaRef);
	});

	const rows = props.rows ?? 6;

	return (
		<div
			class={
				props.editorClass
					? `${styles.editor} ${props.editorClass}`
					: styles.editor
			}
		>
			{/* 工具栏只在有文件能力时出现：没注入就不承诺"插入文件/拖入文件" */}
			<Show when={props.filePicker || props.onUploadFile}>
				<div class={styles.toolbar}>
					<Show when={props.filePicker}>
						<button
							type="button"
							class={styles.toolBtn}
							onClick={() => setPickerOpen(true)}
							title="从文件库选择已有文件插入"
						>
							插入文件
						</button>
					</Show>
					<Show when={props.onUploadFile}>
						<span class={styles.toolHint}>可直接粘贴或拖入文件</span>
					</Show>
				</div>
			</Show>
			<textarea
				ref={textareaRef}
				id={props.id}
				class={props.class ?? styles.textarea}
				classList={{ [styles.textareaDrag]: dragover() }}
				value={props.value}
				onInput={onInput}
				onPaste={onPaste}
				onDragOver={onDragOver}
				onDragLeave={onDragLeave}
				onDrop={onDrop}
				rows={rows}
				placeholder={props.placeholder}
			/>
			<Show when={props.preview && props.value.trim()}>
				<div class={styles.preview}>
					<MarkdownRenderer content={props.value} />
				</div>
			</Show>

			{/* 挑选器由使用方注入：Dynamic 让它的 props 跟着 pickerOpen 走 */}
			<Show when={props.filePicker}>
				<Dynamic
					component={props.filePicker}
					isOpen={pickerOpen()}
					onClose={() => setPickerOpen(false)}
					onPick={onPicked}
				/>
			</Show>
		</div>
	);
}
