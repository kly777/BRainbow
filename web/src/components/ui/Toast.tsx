import { For, Show } from "solid-js";
import { dismissToast, type ToastItem, toasts } from "./toastStore.ts";
import styles from "./Toast.module.css";

function iconForType(type: ToastItem["type"]): string {
    switch (type) {
        case "error":
            return "✕";
        case "warning":
            return "⚠";
        case "success":
            return "✓";
        case "info":
            return "ℹ";
    }
}

export default function ToastContainer() {
    return (
        <Show when={toasts().length > 0}>
            <div class={styles.container} aria-live="polite" role="status">
                <For each={toasts()}>
                    {(toast) => (
                        <div
                            class={`${styles.toast} ${styles[toast.type]} ${
                                toast.leaving ? styles.leaving : ""
                            }`}
                            role="alert"
                        >
                            <div class={styles.body}>
                                <span class={styles.icon}>
                                    {iconForType(toast.type)}
                                </span>
                                <div class={styles.content}>
                                    <div class={styles.title}>
                                        {toast.details
                                            ? (
                                                <>
                                                    {toast.title}
                                                    <code class={styles.code}>
                                                        {toast.details}
                                                    </code>
                                                </>
                                            )
                                            : (
                                                toast.title
                                            )}
                                    </div>
                                    <Show when={toast.message}>
                                        <div class={styles.message}>
                                            {toast.message}
                                        </div>
                                    </Show>
                                </div>
                            </div>
                            <button
                                type="button"
                                class={styles.close}
                                onClick={() => dismissToast(toast.id)}
                                aria-label="关闭通知"
                            >
                                ✕
                            </button>
                            {/* 倒计时进度条 */}
                            <Show when={toast.duration > 0}>
                                <div
                                    class={styles.progress}
                                    style={{
                                        "animation-duration":
                                            `${toast.duration}ms`,
                                    }}
                                />
                            </Show>
                        </div>
                    )}
                </For>
            </div>
        </Show>
    );
}
