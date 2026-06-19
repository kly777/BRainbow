import { useNavigate, useParams } from "@solidjs/router";
import {
    type Component,
    createEffect,
    createResource,
    createSignal,
    Show,
} from "solid-js";
import {
    deleteCardE,
    getCardE,
    updateCardE,
    uploadImage,
} from "../../apis/cardApi.ts";
import type { UpdateCardRequest } from "../../apis/types/index.ts";
import { getErrorMessage } from "../../apis/types/index.ts";
import Breadcrumb from "../../components/ui/Breadcrumb.tsx";
import Markdown from "../../components/ui/Markdown.tsx";
import { AsyncView } from "../../components/ui/AsyncView.tsx";
import styles from "./CardEdit.module.css";

const CardEditPage: Component = () => {
    const params = useParams();
    const navigate = useNavigate();

    const cardId = () => {
        const id = params.id;
        if (!id || !/^\d+$/.test(id)) return NaN;
        return parseInt(id, 10);
    };

    const [card, { refetch }] = createResource(async () => {
        const id = cardId();
        if (Number.isNaN(id)) throw new Error("无效ID");
        return await getCardE(id);
    });

    const [content, setContent] = createSignal("");
    const [isSubmitting, setIsSubmitting] = createSignal(false);
    const [error, setError] = createSignal("");
    const [isUploading, setIsUploading] = createSignal(false);
    let fileInputRef: HTMLInputElement | undefined;
    let textareaRef: HTMLTextAreaElement | undefined;

    createEffect(() => {
        const c = card();
        if (c) setContent(c.content);
    });

    const doSave = async () => {
        if (!content().trim()) {
            setError("内容不能为空");
            return;
        }
        setIsSubmitting(true);
        setError("");
        try {
            const req: UpdateCardRequest = { content: content().trim() };
            await updateCardE(cardId(), req);
            navigate(`/c/${cardId()}`);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "s") {
            e.preventDefault();
            doSave();
        }
    };

    const handleDelete = async () => {
        if (!confirm("确定要删除？")) return;
        try { await deleteCardE(cardId()); navigate("/c"); } catch { /* ignore */ }
    };

    // ── 图片上传 ──
    const triggerUpload = () => {
        fileInputRef?.click();
    };

    const handleFileSelected = async (e: Event) => {
        const input = e.currentTarget as HTMLInputElement;
        const file = input.files?.[0];
        if (!file) return;

        if (!file.type.startsWith("image/")) {
            setError("仅支持图片格式");
            input.value = "";
            return;
        }

        setIsUploading(true);
        setError("");
        try {
            const image = await uploadImage(file);
            const md = `![${image.original_name}](${image.url})`;
            insertAtCursor(md);
        } catch (err) {
            setError(`上传失败: ${getErrorMessage(err)}`);
        } finally {
            setIsUploading(false);
            input.value = "";
        }
    };

    const handlePaste = (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith("image/")) {
                e.preventDefault();
                const file = item.getAsFile();
                if (!file) continue;

                setIsUploading(true);
                setError("");
                uploadImage(file)
                    .then((image) => {
                        const md = `![${image.original_name}](${image.url})`;
                        insertAtCursor(md);
                    })
                    .catch((err) => {
                        setError(`上传失败: ${getErrorMessage(err)}`);
                    })
                    .finally(() => setIsUploading(false));
                break;
            }
        }
    };

    const insertAtCursor = (text: string) => {
        const ta = textareaRef;
        if (!ta) {
            setContent(content() + text);
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const before = content().slice(0, start);
        const after = content().slice(end);
        const newContent = before + text + after;
        setContent(newContent);
        requestAnimationFrame(() => {
            ta.focus();
            ta.setSelectionRange(start + text.length, start + text.length);
        });
    };

    return (
        <div class={styles.container}>
            <Breadcrumb items={[
                { label: "首页", href: "/" },
                { label: "卡片", href: "/c" },
                { label: `#${cardId()}`, href: `/c/${cardId()}` },
                { label: "编辑" },
            ]} />
            <div class={styles.toolbar}>
                <button
                    type="button"
                    class={styles.backBtn}
                    onClick={() => navigate(`/c/${cardId()}`)}
                >
                    ← 返回
                </button>
                <span class={styles.toolbarTitle}>编辑卡片</span>
                <div class={styles.toolbarActions}>
                    <button
                        type="button"
                        class={styles.uploadBtn}
                        onClick={triggerUpload}
                        disabled={isUploading()}
                    >
                        {isUploading() ? "上传中..." : "📷 图片"}
                    </button>
                    <button
                        type="button"
                        class={styles.deleteBtn}
                        onClick={handleDelete}
                    >
                        删除
                    </button>
                    <button
                        type="button"
                        class={styles.saveBtn}
                        onClick={doSave}
                        disabled={isSubmitting()}
                    >
                        {isSubmitting() ? "保存中..." : "保存"}
                    </button>
                </div>
            </div>

            <AsyncView
                data={card() ? [card()] : []}
                loading={card.loading}
                error={card.error}
                onRetry={refetch}
            >
                {() => (
                    <Show when={!card.loading && !card.error}>
                        <Show when={error()}>
                            <div class={styles.errorMsg}>{error()}</div>
                        </Show>
                        <div class={styles.editor}>
                            <textarea
                                class={styles.textarea}
                                ref={textareaRef}
                                value={content()}
                                onInput={(e) =>
                                    setContent(e.currentTarget.value)}
                                onKeyDown={handleKeyDown}
                                onPaste={handlePaste}
                                placeholder="输入 Markdown 内容...支持粘贴图片"
                                disabled={isSubmitting() || isUploading()}
                            />
                            <div class={styles.preview}>
                                <Show when={content().trim()}>
                                    <Markdown content={content()} />
                                </Show>
                                <Show when={!content().trim()}>
                                    <div class={styles.emptyPreview}>
                                        实时预览
                                    </div>
                                </Show>
                            </div>
                        </div>
                    </Show>
                )}
            </AsyncView>
            <input
                type="file"
                ref={fileInputRef}
                class={styles.hiddenInput}
                accept="image/*"
                onChange={handleFileSelected}
            />
        </div>
    );
};

export default CardEditPage;
