import { createSignal, onMount, Show } from "solid-js";
import { For } from "solid-js/web";
import { Effect } from "effect";
import { createMem, getDue, reviewMem, type ChunkPart, type MemItem } from "../apis/memApi.ts";
import { previewDue } from "../lib/fsrs.ts";
import styles from "./MemPage.module.css";

export default function MemPage() {
    const [due, setDue] = createSignal<MemItem[]>([]);
    const [current, setCurrent] = createSignal(0);
    const [showAnswer, setShowAnswer] = createSignal(false);
    const [loading, setLoading] = createSignal(true);
    const [count, setCount] = createSignal(0);

    const [showForm, setShowForm] = createSignal(false);
    const [cueText, setCueText] = createSignal("");
    const [targetText, setTargetText] = createSignal("");
    const [creating, setCreating] = createSignal(false);

    const item = () => due()[current()];

    // 下次复习时间预览
    const preview = () => {
        const it = item();
        if (!it) return {};
        return previewDue(it.state, it.stability, it.difficulty);
    };

    const loadDue = async () => {
        setLoading(true);
        const exit = await Effect.runPromiseExit(getDue());
        if (exit._tag === "Success") {
            setDue([...exit.value.items]);
            setCount(exit.value.due_count);
            setCurrent(0);
            setShowAnswer(false);
        }
        setLoading(false);
    };

    onMount(loadDue);

    const handleCreate = async () => {
        const cue = cueText().trim();
        const target = targetText().trim();
        if (!cue || !target) return;
        setCreating(true);
        await Effect.runPromiseExit(
            createMem(
                [{ type: "text", content: cue }],
                [{ type: "text", content: target }],
                [],
            ),
        );
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
            setCurrent(current() + 1);
            setShowAnswer(false);
        } else {
            loadDue();
        }
    };

    const renderParts = (parts: ChunkPart[]) => (
        <For each={parts}>
            {(p) => {
                if (p.type === "text" && p.content) {
                    return <div class={styles.md}>{p.content}</div>;
                }
                if (p.type === "image" && p.url) {
                    return <img src={p.url} alt="" class={styles.img} />;
                }
                if (p.type === "audio" && p.url) {
                    return (
                        /* biome-ignore lint/a11y/useMediaCaption: 用户自备音频无需字幕 */
                        <audio controls src={p.url} class={styles.audio}>
                            浏览器不支持音频播放
                        </audio>
                    );
                }
                return null;
            }}
        </For>
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
                    <span class={styles.count}>
                        {current() + 1}/{due().length}
                        {count() > due().length ? `（共 ${count()} 个待复习）` : ""}
                    </span>
                </div>
            </div>

            <Show when={showForm()}>
                <div class={styles.form}>
                    <textarea
                        class={styles.formInput}
                        placeholder="线索（支持 Markdown）"
                        value={cueText()}
                        onInput={(e) => setCueText(e.currentTarget.value)}
                        rows={2}
                    />
                    <textarea
                        class={styles.formInput}
                        placeholder="答案（支持 Markdown）"
                        value={targetText()}
                        onInput={(e) => setTargetText(e.currentTarget.value)}
                        rows={2}
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
                        {loading() ? "加载中…" : "没有待复习的记忆，干得好！🎉"}
                    </div>
                }
            >
                <div class={styles.card}>
                    <div class={styles.cue}>
                        <div class={styles.sectionLabel}>线索</div>
                        <div class={styles.content}>{renderParts(item()?.cue.parts ?? [])}</div>
                    </div>

                    <Show when={showAnswer()}>
                        <div class={styles.divider} />
                        <div class={styles.target}>
                            <div class={styles.sectionLabel}>答案</div>
                            <div class={styles.content}>{renderParts(item()?.target.parts ?? [])}</div>
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
                                    <span class={styles.ratingTime}>{preview()[1]}</span>
                                </button>
                                <button type="button" class={styles.hard} onClick={() => rate(2)}>
                                    <span class={styles.ratingLabel}>困难</span>
                                    <span class={styles.ratingTime}>{preview()[2]}</span>
                                </button>
                                <button type="button" class={styles.good} onClick={() => rate(3)}>
                                    <span class={styles.ratingLabel}>良好</span>
                                    <span class={styles.ratingTime}>{preview()[3]}</span>
                                </button>
                                <button type="button" class={styles.easy} onClick={() => rate(4)}>
                                    <span class={styles.ratingLabel}>简单</span>
                                    <span class={styles.ratingTime}>{preview()[4]}</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </Show>
        </div>
    );
}
