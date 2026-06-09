import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { createMem } from "../apis/memApi.ts";
import styles from "./MemAdd.module.css";

/** 解析文本：每行 "线索 | 答案" 或 "线索\t答案" */
function parseBatch(text: string): { cue: string; target: string }[] {
    return text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
            const sep = line.includes("|") ? "|" : "\t";
            const [cue = "", target = ""] = line.split(sep, 2);
            return { cue: cue.trim(), target: target.trim() };
        })
        .filter((p) => p.cue && p.target);
}

export default function MemAdd() {
    const navigate = useNavigate();
    const [cue, setCue] = createSignal("");
    const [target, setTarget] = createSignal("");
    const [creating, setCreating] = createSignal(false);
    const [batchText, setBatchText] = createSignal("");
    const [jsonText, setJsonText] = createSignal("");
    const [batchCount, setBatchCount] = createSignal(0);
    const [mode, setMode] = createSignal<"single" | "batch" | "json">("single");

    const handleCreate = async () => {
        if (!cue().trim() || !target().trim()) return;
        setCreating(true);
        await Effect.runPromiseExit(createMem(cue().trim(), target().trim()));
        setCreating(false);
        navigate("/m/manage");
    };

    const handleBatch = async () => {
        const items = mode() === "json"
            ? parseJson(jsonText())
            : parseBatch(batchText());
        if (items.length === 0) return;
        setCreating(true);
        let done = 0;
        for (const item of items) {
            await Effect.runPromiseExit(createMem(item.cue, item.target));
            done++;
            setBatchCount(done);
        }
        setCreating(false);
        navigate("/m/manage");
    };

    const currentCount = () => mode() === "json"
        ? parseJson(jsonText()).length
        : parseBatch(batchText()).length;

    const onBatchInput = (e: Event) => {
        const v = (e.target as HTMLTextAreaElement).value;
        setBatchText(v);
        setBatchCount(0);
    };

    const onJsonInput = (e: Event) => {
        const v = (e.target as HTMLTextAreaElement).value;
        setJsonText(v);
        setBatchCount(0);
    };

    function parseJson(text: string): { cue: string; target: string }[] {
        try {
            const arr = JSON.parse(text);
            if (!Array.isArray(arr)) return [];
            return arr
                .filter((it): it is { cue: string; target: string } =>
                    typeof it?.cue === "string" && typeof it?.target === "string",
                )
                .map((it) => ({ cue: it.cue.trim(), target: it.target.trim() }))
                .filter((it) => it.cue && it.target);
        } catch {
            return [];
        }
    }

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <h1 class={styles.title}>添加记忆</h1>
                <div class={styles.modeTabs}>
                    <button
                        type="button"
                        class={mode() === "single" ? styles.modeActive : styles.modeBtn}
                        onClick={() => setMode("single")}
                    >
                        单个
                    </button>
                    <button
                        type="button"
                        class={mode() === "batch" ? styles.modeActive : styles.modeBtn}
                        onClick={() => setMode("batch")}
                    >
                        文本
                    </button>
                    <button
                        type="button"
                        class={mode() === "json" ? styles.modeActive : styles.modeBtn}
                        onClick={() => setMode("json")}
                    >
                        JSON
                    </button>
                </div>
            </div>

            <div class={styles.form}>
                <Show when={mode() === "single"}>
                    <label class={styles.label}>
                        线索（Markdown）
                        <textarea
                            class={styles.textarea}
                            placeholder="例如：质能方程 E=mc²"
                            value={cue()}
                            onInput={(e) => setCue(e.currentTarget.value)}
                            rows={4}
                        />
                    </label>
                    <label class={styles.label}>
                        答案（Markdown）
                        <textarea
                            class={styles.textarea}
                            placeholder="例如：能量等于质量乘以光速的平方"
                            value={target()}
                            onInput={(e) => setTarget(e.currentTarget.value)}
                            rows={4}
                        />
                    </label>
                    <div class={styles.actions}>
                        <button type="button" class={styles.cancel} onClick={() => navigate("/m/manage")}>取消</button>
                        <button
                            type="button"
                            class={styles.submit}
                            onClick={handleCreate}
                            disabled={creating() || !cue().trim() || !target().trim()}
                        >
                            {creating() ? "创建中…" : "创建记忆"}
                        </button>
                    </div>
                </Show>

                <Show when={mode() === "batch" || mode() === "json"}>
                    <Show when={mode() === "batch"}>
                        <label class={styles.label}>
                            每行一条：<code>线索 | 答案</code> 或 <code>线索&nbsp;&nbsp;&nbsp;&nbsp;答案</code>
                            <textarea
                                class={styles.textarea}
                                placeholder="光合作用 | 植物将光能转化为化学能\n勾股定理 | a²+b²=c²"
                                value={batchText()}
                                onInput={onBatchInput}
                                rows={10}
                            />
                        </label>
                    </Show>
                    <Show when={mode() === "json"}>
                        <label class={styles.label}>
                            <div class={styles.hint}>
                                粘贴 JSON 数组，每项需含 <code>cue</code>（线索）和 <code>target</code>（答案）字段，例如：<code>[&lbrace;"cue": "线索", "target": "答案"&rbrace;]</code>
                            </div>
                            <textarea
                                class={styles.textarea}
                                value={jsonText()}
                                onInput={onJsonInput}
                                placeholder="粘贴 JSON 数组…"
                                rows={10}
                            />
                        </label>
                    </Show>
                    {batchCount() > 0 && (
                        <div class={styles.progress}>
                            已创建 {batchCount()}/{currentCount()}
                        </div>
                    )}
                    <div class={styles.actions}>
                        <button type="button" class={styles.cancel} onClick={() => navigate("/m/manage")}>取消</button>
                        <button
                            type="button"
                            class={styles.submit}
                            onClick={handleBatch}
                            disabled={creating() || currentCount() === 0}
                        >
                            {creating()
                                ? `创建中 ${batchCount()}/${currentCount()}`
                                : `批量创建 (${currentCount()} 条)`}
                        </button>
                    </div>
                </Show>
            </div>
        </div>
    );
}
