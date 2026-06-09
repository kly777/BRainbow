import { createSignal } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { Effect } from "effect";
import { createMem } from "../apis/memApi.ts";
import styles from "./MemAdd.module.css";

export default function MemAdd() {
    const navigate = useNavigate();
    const [cue, setCue] = createSignal("");
    const [target, setTarget] = createSignal("");
    const [creating, setCreating] = createSignal(false);

    const handleCreate = async () => {
        if (!cue().trim() || !target().trim()) return;
        setCreating(true);
        const exit = await Effect.runPromiseExit(createMem(cue().trim(), target().trim()));
        if (exit._tag === "Success") {
            navigate("/m/manage");
        }
        setCreating(false);
    };

    return (
        <div class={styles.page}>
            <div class={styles.topBar}>
                <h1 class={styles.title}>添加记忆</h1>
            </div>

            <div class={styles.form}>
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
                    <button
                        type="button"
                        class={styles.cancel}
                        onClick={() => navigate("/m/manage")}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        class={styles.submit}
                        onClick={handleCreate}
                        disabled={creating() || !cue().trim() || !target().trim()}
                    >
                        {creating() ? "创建中…" : "创建记忆"}
                    </button>
                </div>
            </div>
        </div>
    );
}
