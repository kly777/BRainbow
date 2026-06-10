interface Props {
    value: string;
    onInput: (value: string) => void;
    class?: string;
    rows?: number;
    placeholder?: string;
    id?: string;
}

/**
 * Markdown 编辑器 —— 极简 textarea + 粘贴增强
 *
 * - 粘贴图片文件 → 上传 → 插入 ![](url)
 * - 选中文本后粘贴 URL → 转为 [text](url)
 * - 无内置样式，由父组件通过 class 控制外观
 */

import { uploadImage } from "../../apis/memApi.ts";

export default function Memo(props: Props) {
    let ref!: HTMLTextAreaElement;

    const onPaste = async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            // 图片文件
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) continue;

                const url = await uploadImage(file);
                if (url) insertAtCursor(`![](${url})`);
                return;
            }
        }

        // 文本：如果选中了文字，且粘贴的是 URL → 转为 [text](url)
        const text = e.clipboardData?.getData("text/plain");
        if (text && /^https?:\/\//.test(text.trim())) {
            const start = ref.selectionStart;
            const end = ref.selectionEnd;
            if (start !== end) {
                e.preventDefault();
                const selected = ref.value.slice(start, end);
                insertAtCursor(`[${selected}](${text.trim()})`);
            }
        }
    };

    const insertAtCursor = (insertion: string) => {
        const start = ref.selectionStart;
        const end = ref.selectionEnd;
        const before = props.value.slice(0, start);
        const after = props.value.slice(end);
        props.onInput(before + insertion + after);
        setTimeout(() => {
            ref.focus();
            const pos = start + insertion.length;
            ref.setSelectionRange(pos, pos);
        }, 0);
    };

    const onInput = (e: Event) => {
        props.onInput((e.target as HTMLTextAreaElement).value);
    };

    return (
        <textarea
            ref={ref}
            id={props.id}
            class={props.class}
            value={props.value}
            onInput={onInput}
            onPaste={onPaste}
            rows={props.rows ?? 4}
            placeholder={props.placeholder}
        />
    );
}
