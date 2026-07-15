import { A, useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { importJsonE } from "../apis/memApi.ts";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
import { showToast } from "../components/ui/toastStore.ts";
import { parseBatch, parseImportFile } from "../lib/delimited.ts";
import styles from "./MemAdd.module.css";

// ── 类型 ──

interface PreviewRow {
	cue: string;
	target: string;
	tags: string[];
	selected: boolean;
}

type Mode = "single" | "paste" | "file";

const VALID_MODES: Mode[] = ["single", "paste", "file"];

// ── 组件 ──

export default function MemAdd() {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	// ── 当前模式 ──
	const mode = () => {
		const m = searchParams.mode;
		return typeof m === "string" && VALID_MODES.includes(m as Mode)
			? (m as Mode)
			: "single";
	};
	const setMode = (m: Mode) =>
		setSearchParams({ mode: m === "single" ? undefined : m });

	// ── 单条创建 ──
	const [cue, setCue] = createSignal("");
	const [target, setTarget] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	// ── 批量粘贴 / 文件导入 共享状态 ──
	const [pasteText, setPasteText] = createSignal("");
	const [previewRows, setPreviewRows] = createSignal<PreviewRow[]>([]);
	const [importing, setImporting] = createSignal(false);
	const [importDefaultTags, setImportDefaultTags] = createSignal("");
	const [importResult, setImportResult] = createSignal<{
		imported: number;
		errors: string[];
	} | null>(null);
	const [parseError, setParseError] = createSignal("");

	const selectedCount = createMemo(
		() => previewRows().filter((r) => r.selected).length,
	);

	// ── 单条创建 ──

	const handleCreate = async () => {
		if (!cue().trim() || !target().trim()) return;
		setCreating(true);
		try {
			const { createMemE } = await import("../apis/memApi.ts");
			await createMemE(cue().trim(), target().trim());
			setCue("");
			setTarget("");
		} catch {
			/* ignore */
		}
		setCreating(false);
	};

	// ── 批量粘贴：自动检测 JSON vs 分隔符文本 ──

	function parsePasteText(text: string): PreviewRow[] {
		const trimmed = text.trim();
		if (!trimmed) return [];

		// 尝试 JSON
		if (trimmed.startsWith("[")) {
			try {
				const items = JSON.parse(trimmed);
				const arr = Array.isArray(items) ? items : [];
				return arr
					.map((i: { cue?: string; target?: string; tags?: string[] }) => ({
						cue: (i.cue ?? "").trim(),
						target: (i.target ?? "").trim(),
						tags: i.tags ?? [],
						selected: true,
					}))
					.filter((r: PreviewRow) => r.cue && r.target);
			} catch {
				// JSON 解析失败，fallthrough 到分隔符解析
			}
		}

		// 分隔符格式：每行 cue|target 或 cue\target
		const pairs = parseBatch(trimmed);
		return pairs.map((p) => ({ ...p, tags: [], selected: true }));
	}

	const handlePasteImport = async () => {
		const rows = previewRows().filter((r) => r.selected);
		if (rows.length === 0) return;
		setImporting(true);
		try {
			const tags = importDefaultTags()
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter(Boolean);
			const mems = rows.map((r) => ({
				cue: r.cue,
				target: r.target,
				tags: r.tags,
			}));
			const result = await importJsonE(
				mems,
				tags.length > 0 ? tags : undefined,
			);
			setImportResult(result);
		} catch (err: unknown) {
			showToast({
				type: "error",
				title: "导入失败",
				message: String(err),
				duration: 5000,
			});
		} finally {
			setImporting(false);
		}
	};

	// ── 文件导入 ──

	async function handleFilePicked(file: File | null) {
		if (!file) {
			setPreviewRows([]);
			return;
		}
		try {
			const text = await file.text();
			const rows = parseImportFile(text, file.name);
			setPreviewRows(rows.map((r) => ({ ...r, selected: true })));
			setParseError("");
		} catch (err) {
			setParseError(String(err));
			setPreviewRows([]);
		}
	}

	const handleFileImport = async () => {
		const rows = previewRows().filter((r) => r.selected);
		if (rows.length === 0) return;
		setImporting(true);
		try {
			const tags = importDefaultTags()
				.split(/[;,]/)
				.map((s) => s.trim())
				.filter(Boolean);
			const mems = rows.map((r) => ({
				cue: r.cue,
				target: r.target,
				tags: r.tags,
			}));
			const result = await importJsonE(
				mems,
				tags.length > 0 ? tags : undefined,
			);
			setImportResult(result);
		} catch (err: unknown) {
			showToast({
				type: "error",
				title: "导入失败",
				message: String(err),
				duration: 5000,
			});
		} finally {
			setImporting(false);
		}
	};

	// ── 导入结果重置 ──

	const resetImport = () => {
		setImportResult(null);
		setPreviewRows([]);
		setPasteText("");
		setImportDefaultTags("");
	};

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>
					← 记忆
				</A>
				<h1 class={styles.title}>添加记忆</h1>
				<div class={styles.modeTabs}>
					<button
						type="button"
						class={mode() === "single" ? styles.modeActive : styles.modeBtn}
						onClick={() => setMode("single")}
					>
						单条创建
					</button>
					<button
						type="button"
						class={mode() === "paste" ? styles.modeActive : styles.modeBtn}
						onClick={() => setMode("paste")}
					>
						批量粘贴
					</button>
					<button
						type="button"
						class={mode() === "file" ? styles.modeActive : styles.modeBtn}
						onClick={() => setMode("file")}
					>
						从文件导入
					</button>
				</div>
			</div>

			<div class={styles.form}>
				{/* ========== 单条创建 ========== */}
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
							onClick={() => navigate("/m")}
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

				{/* ========== 批量粘贴 ========== */}
				<Show when={mode() === "paste"}>
					<Show when={importResult()}>
						{/* 导入成功页面 */}
						<ImportResult result={importResult()!} onContinue={resetImport} />
					</Show>
					<Show when={!importResult()}>
						<p class={styles.hint}>支持两种格式（自动识别）：</p>
						<div class={styles.formatHint}>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>PSV（竖线分隔）</p>
								<pre class={styles.formatExample}>
									质能方程|E=mc²
									<br />
									光速|299792458 m/s
								</pre>
								<p class={styles.formatNote}>
									每行一条，用 <code>|</code> 或 <code>Tab</code> 分隔线索和答案
								</p>
							</div>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>JSON</p>
								<pre class={styles.formatExample}>{`[
  {"cue":"质能方程","target":"E=mc²","tags":["物理"]},
  {"cue":"光速","target":"299792458 m/s"}
]`}</pre>
								<p class={styles.formatNote}>
									<code>tags</code> 可选，也可包装为{" "}
									<code>{'{"mems": [...]}'}</code>
								</p>
							</div>
						</div>
						<textarea
							class={styles.textarea}
							value={pasteText()}
							onInput={(e) => {
								const text = e.currentTarget.value;
								setPasteText(text);
								setPreviewRows(parsePasteText(text));
							}}
							rows={8}
							placeholder={"质能方程 | E=mc²\n光速 | 299792458 m/s"}
						/>
						<Show when={previewRows().length > 0}>
							<ImportPreview
								rows={previewRows()}
								selectedCount={selectedCount()}
								onToggle={(i) =>
									setPreviewRows((prev) => {
										const next = [...prev];
										next[i] = { ...next[i], selected: !next[i].selected };
										return next;
									})
								}
								onToggleAll={() => {
									const all = selectedCount() === previewRows().length;
									setPreviewRows((prev) =>
										prev.map((r) => ({ ...r, selected: !all })),
									);
								}}
							/>
							<p class={styles.previewCount}>
								已选 {selectedCount()} / 共 {previewRows().length} 条
							</p>
						</Show>
						<ImportTagInput
							value={importDefaultTags()}
							onChange={setImportDefaultTags}
						/>
						<div class={styles.actions}>
							<button
								type="button"
								class={styles.cancel}
								onClick={() => navigate("/m")}
							>
								取消
							</button>
							<button
								type="button"
								class={styles.submit}
								disabled={selectedCount() === 0 || importing()}
								onClick={handlePasteImport}
							>
								{importing() ? "导入中…" : `导入所选 (${selectedCount()} 条)`}
							</button>
						</div>
					</Show>
				</Show>

				{/* ========== 从文件导入 ========== */}
				<Show when={mode() === "file"}>
					<Show when={importResult()}>
						<ImportResult result={importResult()!} onContinue={resetImport} />
					</Show>
					<Show when={!importResult()}>
						<div class={styles.formatHint}>
							<p class={styles.hintTitle}>支持的文件格式</p>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>CSV（逗号分隔）</p>
								<pre class={styles.formatExample}>
									cue,target,tags
									<br />
									质能方程,E=mc²,物理;公式
									<br />
									光速,299792458 m/s,物理
								</pre>
								<p class={styles.formatNote}>内容含逗号请用引号包裹</p>
							</div>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>PSV（竖线分隔）</p>
								<pre class={styles.formatExample}>
									cue|target|tags
									<br />
									质能方程|E=mc²|物理;公式
									<br />
									光速|299792458 m/s|物理
								</pre>
								<p class={styles.formatNote}>
									导出默认格式，内容含逗号无需转义
								</p>
							</div>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>JSON</p>
								<pre class={styles.formatExample}>{`[
  {"cue":"质能方程","target":"E=mc²","tags":["物理"]},
  {"cue":"光速","target":"299792458 m/s"}
]`}</pre>
								<p class={styles.formatNote}>
									或包装为 <code>{'{"mems": [...]}'}</code>
								</p>
							</div>
						</div>
						<label class={styles.label} for="import-file">
							选择文件
						</label>
						<input
							id="import-file"
							type="file"
							accept=".csv,.psv,.json"
							class={styles.fileInput}
							onChange={(e) =>
								handleFilePicked(e.currentTarget.files?.[0] ?? null)
							}
						/>
						<Show when={parseError()}>
							<p class={styles.importErrors}>{parseError()}</p>
						</Show>
						<Show when={previewRows().length > 0}>
							<ImportPreview
								rows={previewRows()}
								selectedCount={selectedCount()}
								onToggle={(i) =>
									setPreviewRows((prev) => {
										const next = [...prev];
										next[i] = { ...next[i], selected: !next[i].selected };
										return next;
									})
								}
								onToggleAll={() => {
									const all = selectedCount() === previewRows().length;
									setPreviewRows((prev) =>
										prev.map((r) => ({ ...r, selected: !all })),
									);
								}}
							/>
							<p class={styles.previewCount}>
								已选 {selectedCount()} / 共 {previewRows().length} 条
							</p>
						</Show>
						<ImportTagInput
							value={importDefaultTags()}
							onChange={setImportDefaultTags}
						/>
						<div class={styles.actions}>
							<button
								type="button"
								class={styles.cancel}
								onClick={() => navigate("/m")}
							>
								取消
							</button>
							<button
								type="button"
								class={styles.submit}
								disabled={selectedCount() === 0 || importing()}
								onClick={handleFileImport}
							>
								{importing() ? "导入中…" : `导入所选 (${selectedCount()} 条)`}
							</button>
						</div>
					</Show>
				</Show>
			</div>
		</div>
	);
}

// ── 子组件 ──

/** 导入结果展示 */
function ImportResult(props: {
	result: { imported: number; errors: string[] };
	onContinue: () => void;
}) {
	return (
		<div class={styles.importResult}>
			<p>已导入 {props.result.imported} 条记忆</p>
			<Show when={(props.result.errors.length ?? 0) > 0}>
				<p class={styles.importErrors}>错误：</p>
				<ul class={styles.importErrorList}>
					<For each={props.result.errors}>{(e) => <li>{e}</li>}</For>
				</ul>
			</Show>
			<button type="button" class={styles.submit} onClick={props.onContinue}>
				继续导入
			</button>
		</div>
	);
}

/** 导入预览表格 */
function ImportPreview(props: {
	rows: PreviewRow[];
	selectedCount: number;
	onToggle: (index: number) => void;
	onToggleAll: () => void;
}) {
	return (
		<div class={styles.previewTable}>
			<table>
				<thead>
					<tr>
						<th class={styles.previewTh}>
							<input
								type="checkbox"
								checked={props.selectedCount === props.rows.length}
								onChange={props.onToggleAll}
							/>
						</th>
						<th class={styles.previewTh}>线索</th>
						<th class={styles.previewTh}>答案</th>
						<th class={styles.previewTh}>标签</th>
					</tr>
				</thead>
				<tbody>
					<For each={props.rows}>
						{(row, i) => (
							<tr>
								<td class={styles.previewTd}>
									<input
										type="checkbox"
										checked={row.selected}
										onChange={() => props.onToggle(i())}
									/>
								</td>
								<td class={styles.previewTd}>{row.cue.slice(0, 60)}</td>
								<td class={styles.previewTd}>{row.target.slice(0, 60)}</td>
								<td class={styles.previewTd}>
									<For each={row.tags}>
										{(tag) => <span class={styles.previewTag}>{tag}</span>}
									</For>
								</td>
							</tr>
						)}
					</For>
				</tbody>
			</table>
		</div>
	);
}

/** 默认标签输入 */
function ImportTagInput(props: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div class={styles.formGroup}>
			<label for="import-default-tags" class={styles.label}>
				默认标签（可选，所有导入条目都会加上）
			</label>
			<input
				id="import-default-tags"
				type="text"
				class={styles.textInput}
				placeholder="标签1; 标签2"
				value={props.value}
				onInput={(e) => props.onChange(e.currentTarget.value)}
			/>
		</div>
	);
}
