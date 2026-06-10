import { A } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show, For } from "solid-js";
import { Effect, Schema } from "effect";
import { buryMem, editMem, getDue, previewMem, reviewMem, type MemItem } from "../apis/memApi.ts";
import { request } from "../apis/request.ts";
import Markdown from "../components/ui/Markdown.tsx";
import Memo from "../components/ui/Memo.tsx";
import { fmtInterval, fmtLocal } from "../lib/time.ts";
import styles from "./MemPage.module.css";

const OkSchema = Schema.Struct({ ok: Schema.Boolean });

export default function MemPage() {
    const [due, setDue] = createSignal<MemItem[]>([]);
    const [current, setCurrent] = createSignal(0);
    const [showAnswer, setShowAnswer] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [isPreview, setIsPreview] = createSignal(false);
    const [done, setDone] = createSignal(false);
    const [editing, setEditing] = createSignal(false);
    const [editCue, setEditCue] = createSignal("");
    const [editTarget, setEditTarget] = createSignal("");
    const [intervals, setIntervals] = createSignal<readonly number[]>([0, 0, 0, 0]);
    const [showUndo, setShowUndo] = createSignal(false);
    const [sidebarOpen, setSidebarOpen] = createSignal(false);
    let lastAction: { id: number; undoData: Record<string, unknown> } | null = null;

    const item = () => due()[current()];

    const loadPreview = async (id: number) => {
        const exit = await Effect.runPromiseExit(previewMem(id));
        if (exit._tag === "Success") setIntervals(exit.value.intervals);
    };

    const loadDue = async () => {
        setLoading(true);
        const exit = await Effect.runPromiseExit(getDue(7));
        if (exit._tag === "Success") {
            const data = exit.value;
            if (data.items.length === 0 && !data.has_more) {
                setDone(true); setDue([]);
            } else {
                setDone(false);
                const shuffled = [...data.items].sort(() => Math.random() - 0.5);
                setDue(shuffled); setCurrent(0); setShowAnswer(false);
                // 仅一张且非 learning → 提前查看
                setIsPreview(data.items.length === 1 && data.items[0]?.state !== "learning");
                if (shuffled.length > 0) loadPreview(shuffled[0].id);
            }
        }
        setLoading(false);
    };

    onMount(loadDue);

    const rate = async (rating: number) => {
        const it = item(); if (!it) return;
        lastAction = { id: it.id, undoData: { state: it.state, stability: it.stability, difficulty: it.difficulty, step_index: null, lapses: 0, leeched: false, due_at: it.due_at } };
        await Effect.runPromiseExit(reviewMem(it.id, rating));
        setShowUndo(true);
        loadDue();
    };

    const bury = async () => { const it = item(); if (it) { await Effect.runPromiseExit(buryMem(it.id)); loadDue(); } };

    const undo = async () => {
        if (!lastAction) return;
        await Effect.runPromiseExit(request(`/mem/${lastAction.id}/undo`, OkSchema, { method: "POST", body: JSON.stringify(lastAction.undoData) }));
        setShowUndo(false);
        loadDue();
    };

    const startEdit = () => { const it = item(); if (it) { setEditCue(it.cue.content); setEditTarget(it.target.content); setEditing(true); } };
    const saveEdit = async () => { const it = item(); if (it) { await Effect.runPromiseExit(editMem(it.id, editCue(), editTarget())); setEditing(false); } };

    const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.tagName === "INPUT") return;
        if (!showAnswer() && e.key === " ") { e.preventDefault(); setShowAnswer(true); }
        else if (showAnswer()) { const r = ({ "1": 1, "2": 2, "3": 3, "4": 4 })[e.key]; if (r) rate(r); }
    };
    onMount(() => globalThis.addEventListener("keydown", onKey));
    onCleanup(() => globalThis.removeEventListener("keydown", onKey));

    return (
        <div class={styles.page}>
            {/* 左侧栏 */}
            <div class={styles.sidebar} classList={{ [styles.sidebarOpen]: sidebarOpen() }}>
                <div class={styles.sidebarHeader}>
                    <span>学习池 ({due().length}/7)</span>
                    <button type="button" class={styles.sidebarClose} onClick={() => setSidebarOpen(false)}>×</button>
                </div>
                <div class={styles.sidebarList}>
                    <For each={due()}>{(mem, i) => (
                        <button type="button" class={i() === current() ? styles.sidebarActive : styles.sidebarItem} onClick={() => { setCurrent(i()); setShowAnswer(false); setSidebarOpen(false); }}>
                            <span class={styles.sidebarIdx}>#{mem.id}</span>
                            <span class={styles.sidebarText}>{mem.cue.content.slice(0, 40) || "（空）"}</span>
                            <span class={styles.sidebarState}>{mem.state === "new" ? "新" : mem.state === "learning" ? "学" : "复"}</span>
                        </button>
                    )}</For>
                </div>
            </div>

            <div class={styles.main}>
                <div class={styles.topBar}>
                    <button type="button" class={styles.hamburger} onClick={() => setSidebarOpen(!sidebarOpen())}>☰</button>
                    <span class={styles.title}>记忆复习</span>
                    <div class={styles.topRight}>
                        <A href="/m/add" class={styles.addLink}>＋ 添加</A>
                        <A href="/m/manage" class={styles.manageLink}>管理</A>
                        {editing() ? (<><button type="button" class={styles.editLinkBtn} onClick={saveEdit}>保存</button><button type="button" class={styles.editLinkBtn} onClick={() => setEditing(false)}>取消</button></>) : (<button type="button" class={styles.editLinkBtn} onClick={startEdit}>编辑</button>)}
                        <span class={styles.count}>{due().length}/7</span>
                    </div>
                </div>

                <Show when={done()}>
                    <div class={styles.empty}><p>🎉 本轮学习完成！</p><button type="button" class={styles.showBtn} onClick={loadDue}>再学一轮</button></div>
                </Show>

                <Show when={!loading() && !done() && due().length > 0} fallback={<div class={styles.empty}>{loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}</div>}>
                    <div class={styles.card}>
                        <Show when={isPreview() && current() === 0}><div class={styles.previewBanner}>将于 {fmtLocal(item()?.due_at ?? "")} 到期</div></Show>
                        <Show when={editing()} fallback={<><div class={styles.cue}><div class={styles.sectionLabel}>线索</div><div class={styles.content}><Markdown content={item()?.cue.content ?? ""} /></div></div>
                        <Show when={showAnswer()}><div class={styles.divider} /><div class={styles.target}><div class={styles.sectionLabel}>答案</div><div class={styles.content}><Markdown content={item()?.target.content ?? ""} /></div></div></Show></>}>
                            <div class={styles.cue}><div class={styles.sectionLabel}>线索</div><Memo class={styles.editArea} value={editCue()} onInput={setEditCue} rows={3} /></div>
                            <div class={styles.divider} /><div class={styles.target}><div class={styles.sectionLabel}>答案</div><Memo class={styles.editArea} value={editTarget()} onInput={setEditTarget} rows={3} /></div>
                        </Show>
                    </div>
                    <div class={styles.actions}>
                        {!showAnswer() ? (
                            <div class={styles.actionRow}><button type="button" class={styles.buryBtn} onClick={bury}>跳过</button><Show when={showUndo()}><button type="button" class={styles.undoBtn} onClick={undo}>撤销</button></Show><button type="button" class={styles.showBtn} onClick={() => setShowAnswer(true)}>显示答案</button></div>
                        ) : (
                            <div class={styles.ratings}>
                                <button type="button" class={styles.again} onClick={() => rate(1)}><span class={styles.ratingLabel}>忘记</span><span class={styles.ratingTime}>{fmtInterval(intervals()[0])}</span></button>
                                <button type="button" class={styles.hard} onClick={() => rate(2)}><span class={styles.ratingLabel}>困难</span><span class={styles.ratingTime}>{fmtInterval(intervals()[1])}</span></button>
                                <button type="button" class={styles.good} onClick={() => rate(3)}><span class={styles.ratingLabel}>良好</span><span class={styles.ratingTime}>{fmtInterval(intervals()[2])}</span></button>
                                <button type="button" class={styles.easy} onClick={() => rate(4)}><span class={styles.ratingLabel}>简单</span><span class={styles.ratingTime}>{fmtInterval(intervals()[3])}</span></button>
                            </div>
                        )}
                    </div>
                </Show>
            </div>
        </div>
    );
}
