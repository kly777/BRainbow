import { createSignal, onMount, Show, For } from "solid-js";
import { Effect } from "effect";
import { A } from "@solidjs/router";
import { getAllMems, deleteMem, type MemItem } from "../apis/memApi.ts";
import Markdown from "../components/ui/Markdown.tsx";
import styles from "./MemManage.module.css";

async function loadAllMems(): Promise<MemItem[]> {
    const exit = await Effect.runPromiseExit(getAllMems(500));
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
    const fmt = d.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    if (diff < 0) return `已到期 (${fmt})`;
    return fmt;
}

function previewText(content: string): string {
    return content.slice(0, 50).replace(/\n/g, " ") || "（空）";
}

export default function MemManage() {
    const [mems, setMems] = createSignal<MemItem[]>([]);
    const [loading, setLoading] = createSignal(true);
    const [selected, setSelected] = createSignal<number | null>(null);

    const load = async () => {
        setLoading(true);
        setMems(await loadAllMems());
        setLoading(false);
    };

    onMount(load);

    const handleDelete = async (id: number) => {
        if (!confirm("确定删除？")) return;
        await Effect.runPromiseExit(deleteMem(id));
        if (selected() === id) setSelected(null);
        load();
    };

    const detail = () => mems().find((m) => m.id === selected());

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <h1 class={styles.title}>记忆管理</h1>
                <div class={styles.topActions}>
                    <A href="/m/add" class={styles.addLink}>＋ 添加</A>
                    <span class={styles.count}>{mems().length} 个</span>
                </div>
            </div>

            <div class={styles.split}>
                {/* 左侧表格 */}
                <div class={styles.tableWrap}>
                    <Show when={!loading()} fallback={<div class={styles.empty}>加载中…</div>}>
                        <table class={styles.table}>
                            <thead>
                                <tr>
                                    <th class={styles.th}>线索</th>
                                    <th class={styles.th}>答案</th>
                                    <th class={styles.th}>状态</th>
                                    <th class={styles.th}>下次复习</th>
                                    <th class={styles.th} />
                                </tr>
                            </thead>
                            <tbody>
                                <For each={mems()}>
                                    {(mem) => (
                                        <tr
                                            class={selected() === mem.id ? styles.rowActive : styles.row}
                                            onClick={() => setSelected(mem.id)}
                                        >
                                            <td class={styles.td}>{previewText(mem.cue.content)}</td>
                                            <td class={styles.td}>{previewText(mem.target.content)}</td>
                                            <td class={styles.td}>
                                                <span classList={{ [styles.badge]: true, [styles[mem.state]]: true }}>
                                                    {mem.state}
                                                </span>
                                            </td>
                                            <td class={styles.tdDue}>{dueLabel(mem.due_at)}</td>
                                            <td class={styles.tdAct}>
                                                <button
                                                    type="button"
                                                    class={styles.delBtn}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDelete(mem.id);
                                                    }}
                                                >
                                                    ×
                                                </button>
                                            </td>
                                        </tr>
                                    )}
                                </For>
                            </tbody>
                        </table>
                    </Show>
                </div>

                {/* 右侧详情 */}
                <div class={styles.detail}>
                    <Show
                        when={detail()}
                        fallback={
                            <div class={styles.empty}>点击左侧条目查看详情</div>
                        }
                    >
                        {(d) => (
                            <>
                                <div class={styles.section}>
                                    <span class={styles.sectionLabel}>线索</span>
                                    <div class={styles.content}><Markdown content={d().cue.content} /></div>
                                </div>
                                <div class={styles.section}>
                                    <span class={styles.sectionLabel}>答案</span>
                                    <div class={styles.content}><Markdown content={d().target.content} /></div>
                                </div>
                                <div class={styles.meta}>
                                    <span>状态：{d().state}</span>
                                    <span>到期：{new Date(d().due_at).toLocaleString("zh-CN")}</span>
                                </div>
                                <button
                                    type="button"
                                    class={styles.deleteBtn}
                                    onClick={() => handleDelete(d().id)}
                                >
                                    删除此记忆
                                </button>
                            </>
                        )}
                    </Show>
                </div>
            </div>
        </div>
    );
}
