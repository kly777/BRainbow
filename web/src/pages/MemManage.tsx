import { createSignal, onMount, Show, For } from "solid-js";
import { Effect } from "effect";
import { getDue, deleteMem, type MemItem } from "../apis/memApi.ts";
import styles from "./MemManage.module.css";

async function loadAllMems(): Promise<MemItem[]> {
    const exit = await Effect.runPromiseExit(getDue(200));
    if (exit._tag === "Success") {
        return [...exit.value.items].sort(
            (a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime(),
        );
    }
    return [];
}

function dueLabel(ts: string): string {
    const d = new Date(ts);
    const diff = (d.getTime() - Date.now()) / 1000;
    if (diff < 0) return "已到期";
    if (diff < 3600) return `${Math.round(diff / 60)}分钟后`;
    if (diff < 86400) return `${Math.round(diff / 3600)}小时后`;
    return `${Math.round(diff / 86400)}天后`;
}

export default function MemManage() {
    const [mems, setMems] = createSignal<MemItem[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [expanded, setExpanded] = createSignal<number | null>(null);

    const load = async () => {
        setLoading(true);
        setMems(await loadAllMems());
        setLoading(false);
    };

    onMount(load);

    const handleDelete = async (id: number) => {
        if (!confirm("确定删除？")) return;
        await Effect.runPromiseExit(deleteMem(id));
        load();
    };

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <h1 class={styles.title}>记忆管理</h1>
                <span class={styles.count}>{mems().length} 个记忆项</span>
            </div>

            <Show when={!loading()} fallback={<div class={styles.empty}>加载中…</div>}>
                <div class={styles.list}>
                    <For each={mems()}>
                        {(mem) => (
                            <div class={styles.item}>
                                <button
                                    type="button"
                                    class={styles.itemHeader}
                                    onClick={() => setExpanded(expanded() === mem.id ? null : mem.id)}
                                >
                                    <span class={styles.itemLabel}>
                                        {mem.cue.content.slice(0, 60) || "（空）"}
                                    </span>
                                    <span class={styles.itemMeta}>
                                        <span classList={{ [styles.badge]: true, [styles[mem.state]]: true }}>
                                            {mem.state}
                                        </span>
                                        <span class={styles.due}>{dueLabel(mem.due_at)}</span>
                                        <span class={styles.arrow}>{expanded() === mem.id ? "▾" : "▸"}</span>
                                    </span>
                                </button>

                                <Show when={expanded() === mem.id}>
                                    <div class={styles.detail}>
                                        <div class={styles.section}>
                                            <span class={styles.sectionLabel}>线索</span>
                                            <pre class={styles.content}>{mem.cue.content}</pre>
                                        </div>
                                        <div class={styles.section}>
                                            <span class={styles.sectionLabel}>答案</span>
                                            <pre class={styles.content}>{mem.target.content}</pre>
                                        </div>
                                        <div class={styles.actions}>
                                            <button
                                                type="button"
                                                class={styles.deleteBtn}
                                                onClick={() => handleDelete(mem.id)}
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>
                                </Show>
                            </div>
                        )}
                    </For>
                </div>
            </Show>
        </div>
    );
}
