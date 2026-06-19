import { Show, createSignal } from "solid-js";
import { uploadMedia } from "../../apis/mediaApi.ts";
import MarkdownRenderer from "./Markdown.tsx";
import styles from "./markdown-editor.module.css";

interface MarkdownEditorProps {
  value: string;
  onInput: (value: string) => void;
  preview?: boolean;
  rows?: number;
  placeholder?: string;
  class?: string;
  id?: string;
}

export default function MarkdownEditor(props: MarkdownEditorProps) {
  let textareaRef!: HTMLTextAreaElement;
  const [dragover, setDragover] = createSignal(false);

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

  // ── 粘贴增强 ──

  const onPaste = async (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const media = await uploadMedia(file);
          insertAtCursor(`![](${media.url})`);
        } catch {
          /* 全局 toast 已处理 */
        }
        return;
      }
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
      if (file.type.startsWith("image/")) {
        try {
          const media = await uploadMedia(file);
          insertAtCursor(`![](${media.url})\n`);
        } catch {
          /* 全局 toast 已处理 */
        }
      }
    }
  };

  // ── 输入 ──

  const onInput = (e: Event) => {
    props.onInput((e.target as HTMLTextAreaElement).value);
  };

  const rows = props.rows ?? 6;

  return (
    <div class={styles.editor}>
      <textarea
        ref={textareaRef}
        id={props.id}
        class={dragover() ? styles.textareaDrag : styles.textarea}
        classList={{ [props.class ?? ""]: !!props.class }}
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
    </div>
  );
}
