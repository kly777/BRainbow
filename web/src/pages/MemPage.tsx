import { A } from "@solidjs/router";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Effect } from "effect";
import { getDue, previewMem, reviewMem, type MemItem } from "../apis/memApi.ts";
import Markdown from "../components/ui/Markdown.tsx";
import styles from "./MemPage.module.css";

export default function MemPage() {
    const [due, setDue] = createSignal<MemItem[]>([]);
    const [current, setCurrent] = createSignal(0);
    const [showAnswer, setShowAnswer] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [isPreview, setIsPreview] = createSignal(false);

    const item = () => due()[current()];

    const [intervals, setIntervals] = createSignal([0, 0, 0, 0]);

    const loadPreview = async (id: number) => {
        const exit = await Effect.runPromiseExit(previewMem(id));
        if (exit._tag === "Success") {
            setIntervals(exit.value.intervals);
        }
    };

    const previewLabel = (secs: number) => {
        if (secs < 120) return "1分钟";
        if (secs < 3600) return `${Math.round(secs / 60)}分钟`;
        if (secs < 86400) return `${Math.round(secs / 3600)}小时`;
        if (secs < 2592000) return `${Math.round(secs / 86400)}天`;
        return `${Math.round(secs / 2592000)}个月`;
    };

    const dueStr = (ts: string) => {
        const t = ts.endsWith("Z") ? ts : `${ts}Z`;
        return new Date(t).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    };

    const loadDue = async () => {
        setLoading(true);
        const exit = await Effect.runPromiseExit(getDue(7));
        if (exit._tag === "Success") {
            setDue([...exit.value.items]);
            setCurrent(0);
            setShowAnswer(false);
            setIsPreview(exit.value.due_count === 0 && exit.value.items.length > 0);
            if (exit.value.items.length > 0) {
                loadPreview(exit.value.items[0].id);
            }
        }
        setLoading(false);
    };

    const onKey = (e: KeyboardEvent) => {
        if (e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.tagName === "INPUT") return;
        if (!showAnswer() && e.key === " ") {
            e.preventDefault();
            setShowAnswer(true);
        } else if (showAnswer()) {
            const r = ({ "1": 1, "2": 2, "3": 3, "4": 4 })[e.key];
            if (r) rate(r);
        }
    };

    onMount(() => {
        loadDue();
        globalThis.addEventListener("keydown", onKey);
    });

    onCleanup(() => globalThis.removeEventListener("keydown", onKey));

    const rate = async (rating: number) => {
        if (!item()) return;
        await Effect.runPromiseExit(reviewMem(item().id, rating));
        nextOrReload();
    };

    const nextOrReload = () => {
        if (current() + 1 < due().length) {
            const next = current() + 1;
            setCurrent(next);
            setShowAnswer(false);
            const it = due()[next];
            if (it) loadPreview(it.id);
        } else {
            loadDue();
        }
    };



    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <span class={styles.title}>记忆复习</span>
                <div class={styles.topRight}>
                    <A href="/m/add" class={styles.addLink}>＋ 添加</A>
                    <A href="/m/manage" class={styles.manageLink}>管理</A>
                    <span class={styles.count}>
                        {current() + 1}/{due().length}
                        {isPreview() ? "（提前查看）" : `${due().length}/7 学习中`}
                    </span>
                </div>
            </div>

            <Show
                when={!loading() && due().length > 0}
                fallback={
                    <div class={styles.empty}>
                        {loading() ? "加载中…" : "没有记忆卡片，去添加一些吧！"}
                    </div>
                }
            >
                <div class={styles.card}>
                    <Show when={isPreview()}>
                        <div class={styles.previewBanner}>
                            将于 {dueStr(item()?.due_at ?? "")} 到期
                        </div>
                    </Show>
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
                </div>

                <div class={styles.actions}>
                    {!showAnswer() ? (
                        <button
                            type="button"
                            class={styles.showBtn}
                            onClick={() => setShowAnswer(true)}
                        >
                            显示答案
                        </button>
                    ) : (
                        <div class={styles.ratings}>
                            <button type="button" class={styles.again} onClick={() => rate(1)}>
                                <span class={styles.ratingLabel}>忘记</span>
                                <span class={styles.ratingTime}>{previewLabel(intervals()[0])}</span>
                            </button>
                            <button type="button" class={styles.hard} onClick={() => rate(2)}>
                                <span class={styles.ratingLabel}>困难</span>
                                <span class={styles.ratingTime}>{previewLabel(intervals()[1])}</span>
                            </button>
                            <button type="button" class={styles.good} onClick={() => rate(3)}>
                                <span class={styles.ratingLabel}>良好</span>
                                <span class={styles.ratingTime}>{previewLabel(intervals()[2])}</span>
                            </button>
                            <button type="button" class={styles.easy} onClick={() => rate(4)}>
                                <span class={styles.ratingLabel}>简单</span>
                                <span class={styles.ratingTime}>{previewLabel(intervals()[3])}</span>
                            </button>
                        </div>
                    )}
                </div>
            </Show>
        </div>
    );
}
