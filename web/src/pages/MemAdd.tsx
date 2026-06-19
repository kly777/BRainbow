import { createSignal, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { createMemE } from "../apis/memApi.ts";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
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
		try {
			await createMemE(cue().trim(), target().trim());
			setCue("");
			setTarget("");
		} catch {
			/* ignore */
		}
		setCreating(false);
	};

	const handleBatch = async () => {
		const pairs = parseBatch(batchText());
		if (pairs.length === 0) return;
		setCreating(true);
		setBatchCount(0);
		for (const p of pairs) {
			try {
				await createMemE(p.cue, p.target);
				setBatchCount((c) => c + 1);
			} catch {
				/* continue */
			}
		}
		setCreating(false);
		setBatchText("");
	};

	const handleJson = async () => {
		let items: { cue: string; target: string }[] = [];
		try {
			items = JSON.parse(jsonText());
		} catch {
			return;
		}
		const valid = items.filter((i) => i.cue && i.target);
		if (valid.length === 0) return;
		setCreating(true);
		setBatchCount(0);
		for (const p of valid) {
			try {
				await createMemE(p.cue, p.target);
				setBatchCount((c) => c + 1);
			} catch {
				/* continue */
			}
		}
		setCreating(false);
		setJsonText("");
	};

	const handleKeyDown = (e: KeyboardEvent, handler: () => Promise<void>) => {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			handler();
		}
	};

	const currentCount = () => {
		if (mode() === "batch") return parseBatch(batchText()).length;
		if (mode() === "json") {
			try {
				return (JSON.parse(jsonText()) as unknown[]).filter(
					(i: unknown) =>
						i &&
						typeof i === "object" &&
						"cue" in (i as Record<string, unknown>) &&
						"target" in (i as Record<string, unknown>),
				).length;
			} catch {
				return 0;
			}
		}
		return 0;
	};

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
						单条
					</button>
					<button
						type="button"
						class={mode() === "batch" ? styles.modeActive : styles.modeBtn}
						onClick={() => setMode("batch")}
					>
						批量
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
					<label class={styles.label} for="add-cue">
						线索（Markdown）
					</label>
					<MarkdownEditor
						id="add-cue"
						class={styles.textarea}
						placeholder="例如：质能方程 E=mc²"
						value={cue()}
						onInput={setCue}
						rows={4}
					/>
					<label class={styles.label} for="add-target">
						答案（Markdown）
					</label>
					<MarkdownEditor
						id="add-target"
						class={styles.textarea}
						placeholder="例如：能量等于质量乘以光速的平方"
						value={target()}
						onInput={setTarget}
						rows={4}
					/>
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
							{creating() ? "创建中..." : "创建"}
						</button>
					</div>
				</Show>

				<Show when={mode() === "batch"}>
					<p class={styles.hint}>
						每行一条：<code>线索 | 答案</code>或<code>线索 制表符 答案</code>
					</p>
					<textarea
						class={styles.textarea}
						value={batchText()}
						onInput={(e) => setBatchText(e.currentTarget.value)}
						rows={8}
						placeholder={"质能方程 | E=mc²\n光速 | 299792458 m/s"}
					/>
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
							onClick={handleBatch}
							disabled={creating() || currentCount() === 0}
						>
							{creating()
								? `创建中 ${batchCount()}/${currentCount()}`
								: `批量创建 (${currentCount()} 条)`}
						</button>
					</div>
				</Show>

				<Show when={mode() === "json"}>
					<p class={styles.hint}>
						每行一条 JSON：{"{"}"cue": "...", "target": "..."
						{"}"}
					</p>
					<textarea
						class={styles.textarea}
						value={jsonText()}
						onInput={(e) => setJsonText(e.currentTarget.value)}
						rows={8}
						placeholder={'[{"cue":"光速","target":"299792458 m/s"}]'}
						onKeyDown={(e) => handleKeyDown(e, handleJson)}
					/>
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
							onClick={handleJson}
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
