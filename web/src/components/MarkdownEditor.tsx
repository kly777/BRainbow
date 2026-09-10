import { Markdown as MarkdownRenderer } from "@components/ui";
import { uploadFile } from "@modules/file/api";
import FilePickerModal, {
	type PickedFile,
} from "@modules/file/components/FilePickerModal.tsx";
import { createSignal, Show } from "solid-js";
import styles from "./markdown-editor.module.css";

interface MarkdownEditorProps {
	value: string;
	onInput: (value: string) => void;
	/**
	 * 上传文件并返回可插入 Markdown 的 URL。
	 * 不传时使用文件模块默认实现（components 层与业务模块的既有耦合点，
	 * 保留为可注入接缝，便于测试或其他模块替换）。
	 */
	onUploadFile?: (
		file: File,
	) => Promise<{ url: string; name: string; mime: string }>;
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

/** 默认上传实现：走通用文件服务（去重、白名单外的未知类型也能存） */
const defaultUpload = async (file: File) => {
	const uploaded = await uploadFile(file);
	return {
		url: uploaded.url,
		name: uploaded.original_name,
		mime: uploaded.mime_type,
	};
};

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
		const upload = props.onUploadFile ?? defaultUpload;
		const uploaded = await upload(file);
		insertAtCursor(
			`${buildMarkdownRef(uploaded.mime, uploaded.url, uploaded.name)}\n`,
		);
	};

	/** 从文件库挑选后插入（与上传插入同一套 Markdown 格式） */
	const onPicked = (file: PickedFile) => {
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
		if (!files) return;

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
			<div class={styles.toolbar}>
				<button
					type="button"
					class={styles.toolBtn}
					onClick={() => setPickerOpen(true)}
					title="从文件库选择已有文件插入"
				>
					插入文件
				</button>
				<span class={styles.toolHint}>可直接粘贴或拖入文件</span>
			</div>
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

			<FilePickerModal
				isOpen={pickerOpen()}
				onClose={() => setPickerOpen(false)}
				onPick={onPicked}
			/>
		</div>
	);
}
