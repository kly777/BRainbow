import { A } from "@solidjs/router";
import { createSignal, onMount, Show } from "solid-js";
import { Effect } from "effect";
import { createMem, getDue, previewMem, reviewMem, type MemItem } from "../apis/memApi.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
    const [due, setDue] = createSignal<MemItem[]>([]);
    const [current, setCurrent] = createSignal(0);
    const [showAnswer, setShowAnswer] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [count, setCount] = createSignal(0);
    const [isPreview, setIsPreview] = createSignal(false);

    const [showForm, setShowForm] = createSignal(false);
    const [cueText, setCueText] = createSignal("");
    const [targetText, setTargetText] = createSignal("");
    const [creating, setCreating] = createSignal(false);

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

    const loadDue = async () => {
        setLoading(true);
        const exit = await Effect.runPromiseExit(getDue());
        if (exit._tag === "Success") {
            setDue([...exit.value.items]);
            setCount(exit.value.due_count);
            setCurrent(0);
            setShowAnswer(false);
            setIsPreview(exit.value.due_count === 0 && exit.value.items.length > 0);
            if (exit.value.items.length > 0) {
                loadPreview(exit.value.items[0].id);
            }
        }
        setLoading(false);
    };

    onMount(loadDue);

    const handleCreate = async () => {
        const cue = cueText().trim();
        const target = targetText().trim();
        if (!cue || !target) return;
        setCreating(true);
        await Effect.runPromiseExit(createMem(cue, target));
        setCueText("");
        setTargetText("");
        setShowForm(false);
        setCreating(false);
    };

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

    const md = (content: string) => (
        <div class={styles.md}>{content}</div>
    );

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <span class={styles.title}>记忆复习</span>
                <div class={styles.topRight}>
                    <button
                        type="button"
                        class={styles.addBtn}
                        onClick={() => setShowForm(!showForm())}
                    >
                        {showForm() ? "收起" : "＋ 添加"}
                    </button>
                    <A href="/m/manage" class={styles.manageLink}>管理</A>
                    <span class={styles.count}>
                        {current() + 1}/{due().length}
                        {isPreview() ? "（提前查看）" : count() > due().length ? `（共 ${count()} 个待复习）` : ""}
                    </span>
                </div>
            </div>

            <Show when={showForm()}>
                <div class={styles.form}>
                    <textarea
                        class={styles.formInput}
                        placeholder="线索（Markdown）"
                        value={cueText()}
                        onInput={(e) => setCueText(e.currentTarget.value)}
                        rows={3}
                    />
                    <textarea
                        class={styles.formInput}
                        placeholder="答案（Markdown）"
                        value={targetText()}
                        onInput={(e) => setTargetText(e.currentTarget.value)}
                        rows={3}
                    />
                    <button
                        type="button"
                        class={styles.formSubmit}
                        onClick={handleCreate}
                        disabled={creating() || !cueText().trim() || !targetText().trim()}
                    >
                        {creating() ? "创建中…" : "创建记忆"}
                    </button>
                </div>
            </Show>

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
                            将于 {new Date(item()?.due_at ?? "").toLocaleString("zh-CN")} 到期
                        </div>
                    </Show>
                    <div class={styles.cue}>
                        <div class={styles.sectionLabel}>线索</div>
                        <div class={styles.content}>{md(item()?.cue.content ?? "")}</div>
                    </div>

                    <Show when={showAnswer()}>
                        <div class={styles.divider} />
                        <div class={styles.target}>
                            <div class={styles.sectionLabel}>答案</div>
                            <div class={styles.content}>{md(item()?.target.content ?? "")}</div>
                        </div>
                    </Show>

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
                </div>
            </Show>
        </div>
    );
}
