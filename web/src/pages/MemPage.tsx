import { A } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Effect } from "effect";
import { buryMem, editMem, getDue, previewMem, reviewMem, type MemItem } from "../apis/memApi.ts";
import { request } from "../apis/request.ts";
import { Schema } from "effect";

const OkSchema = Schema.Struct({ ok: Schema.Boolean });
import Markdown from "../components/ui/Markdown.tsx";
import { fmtInterval, fmtLocal } from "../lib/time.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
    const [due, setDue] = createSignal<MemItem[]>([]);
    const [current, setCurrent] = createSignal(0);
    const [showAnswer, setShowAnswer] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [isPreview, setIsPreview] = createSignal(false);
    const [editing, setEditing] = createSignal(false);
    const [editCue, setEditCue] = createSignal("");
    const [editTarget, setEditTarget] = createSignal("");

    const item = () => due()[current()];
    const [intervals, setIntervals] = createSignal<readonly number[]>([0, 0, 0, 0]);
    const [showUndo, setShowUndo] = createSignal(false);
    let lastAction: { id: number; undoData: Record<string, unknown> } | null = null;

    const loadPreview = async (id: number) => {
        const exit = await Effect.runPromiseExit(previewMem(id));
        if (exit._tag === "Success") setIntervals(exit.value.intervals);
    };

    const loadDue = async () => {
        setLoading(true);
        const exit = await Effect.runPromiseExit(getDue(7));
        if (exit._tag === "Success") {
            setDue([...exit.value.items]);
            setCurrent(0);
            setShowAnswer(false);
            setIsPreview(exit.value.due_count === 0 && exit.value.items.length > 0);
            if (exit.value.items.length > 0) loadPreview(exit.value.items[0].id);
        }
        setLoading(false);
    };

    const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.tagName === "INPUT") return;
        if (!showAnswer() && e.key === " ") { e.preventDefault(); setShowAnswer(true); }
        else if (showAnswer()) {
            const r = ({ "1": 1, "2": 2, "3": 3, "4": 4 })[e.key];
            if (r) rate(r);
        }
    };

    onMount(() => { loadDue(); globalThis.addEventListener("keydown", onKey); });
    onCleanup(() => globalThis.removeEventListener("keydown", onKey));

    const rate = async (rating: number) => {
        const it = item();
        if (!it) return;
        // 保存状态用于撤销
        lastAction = {
            id: it.id,
            undoData: {
                state: it.state, stability: it.stability, difficulty: it.difficulty,
                step_index: null, lapses: 0, leeched: false, due_at: it.due_at,
            },
        };
        await Effect.runPromiseExit(reviewMem(it.id, rating));
        setShowUndo(true);
        nextOrReload();
    };

    const undo = async () => {
        if (!lastAction) return;
        await Effect.runPromiseExit(
            request(`/mem/${lastAction.id}/undo`, OkSchema, {
                method: "POST",
                body: JSON.stringify(lastAction.undoData),
            }),
        );
        setShowUndo(false);
        loadDue();
    };

    const bury = async () => {
        if (!item()) return;
        await Effect.runPromiseExit(buryMem(item().id));
        nextOrReload();
    };

    const startEdit = () => {
        const it = item();
        if (!it) return;
        setEditCue(it.cue.content);
        setEditTarget(it.target.content);
        setEditing(true);
    };

    const saveEdit = async () => {
        const it = item();
        if (!it) return;
        await Effect.runPromiseExit(editMem(it.id, editCue(), editTarget()));
        setEditing(false);
        loadDue();
    };

    const nextOrReload = () => {
        if (current() + 1 < due().length) {
            const next = current() + 1;
            setCurrent(next);
            setShowAnswer(false);
            const it = due()[next];
            if (it) loadPreview(it.id);
        } else loadDue();
    };

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <span class={styles.title}>记忆复习</span>
                <div class={styles.topRight}>
                    <A href="/m/add" class={styles.addLink}>＋ 添加</A>
                    <A href="/m/manage" class={styles.manageLink}>管理</A>
                    {editing() ? (
                        <>
                            <button type="button" class={styles.editLinkBtn} onClick={saveEdit}>保存</button>
                            <button type="button" class={styles.editLinkBtn} onClick={() => setEditing(false)}>取消</button>
                        </>
                    ) : (
                        <button type="button" class={styles.editLinkBtn} onClick={startEdit}>编辑</button>
                    )}
                    <span class={styles.count}>{due().length}/7 学习中</span>
                </div>
            </div>
            <Show when={!loading() && due().length > 0} fallback={<div class={styles.empty}>{loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}</div>}>
                <div class={styles.card}>
                    <Show when={isPreview()}>
                        <div class={styles.previewBanner}>将于 {fmtLocal(item()?.due_at ?? "")} 到期</div>
                    </Show>
                    <Show when={editing()} fallback={
                        <>
                            <div class={styles.cue}>
                                <div class={styles.sectionLabel}>线索</div>
                                <div class={styles.content}><Markdown content={item()?.cue.content ?? ""} /></div>
                            </div>
                            <Show when={showAnswer()}>
                                <div class={styles.divider} />
                                <div class={styles.target}>
                                    <div class={styles.sectionLabel}>答案</div>
                                    <div class={styles.content}><Markdown content={item()?.target.content ?? ""} /></div>
                                </div>
                            </Show>
                        </>
                    }>
                        <div class={styles.cue}>
                            <div class={styles.sectionLabel}>线索</div>
                            <textarea class={styles.editArea} value={editCue()} onInput={(e) => setEditCue(e.currentTarget.value)} rows={3} />
                        </div>
                        <div class={styles.divider} />
                        <div class={styles.target}>
                            <div class={styles.sectionLabel}>答案</div>
                            <textarea class={styles.editArea} value={editTarget()} onInput={(e) => setEditTarget(e.currentTarget.value)} rows={3} />
                        </div>
                    </Show>
                </div>
                <div class={styles.actions}>
                    {!showAnswer() ? (
                        <div class={styles.actionRow}>
                            <button type="button" class={styles.buryBtn} onClick={bury}>跳过</button>
                            <Show when={showUndo()}>
                                <button type="button" class={styles.undoBtn} onClick={undo}>撤销</button>
                            </Show>
                            <button type="button" class={styles.showBtn} onClick={() => setShowAnswer(true)}>显示答案</button>
                        </div>
                    ) : (
                        <div class={styles.ratings}>
                            <button type="button" class={styles.again} onClick={() => rate(1)}>
                                <span class={styles.ratingLabel}>忘记</span><span class={styles.ratingTime}>{fmtInterval(intervals()[0])}</span>
                            </button>
                            <button type="button" class={styles.hard} onClick={() => rate(2)}>
                                <span class={styles.ratingLabel}>困难</span><span class={styles.ratingTime}>{fmtInterval(intervals()[1])}</span>
                            </button>
                            <button type="button" class={styles.good} onClick={() => rate(3)}>
                                <span class={styles.ratingLabel}>良好</span><span class={styles.ratingTime}>{fmtInterval(intervals()[2])}</span>
                            </button>
                            <button type="button" class={styles.easy} onClick={() => rate(4)}>
                                <span class={styles.ratingLabel}>简单</span><span class={styles.ratingTime}>{fmtInterval(intervals()[3])}</span>
                            </button>
                        </div>
                    )}
                </div>
            </Show>
        </div>
    );
}
