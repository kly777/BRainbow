import { A, useNavigate } from "@solidjs/router";
import { createMemo, createSignal, For, Show } from "solid-js";
import { createMemE, importJsonE } from "../apis/memApi.ts";
import MarkdownEditor from "../components/ui/MarkdownEditor.tsx";
import { showToast } from "../components/ui/toastStore.ts";
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
	const [mode, setMode] = createSignal<"single" | "batch" | "json" | "csv">(
		"single",
	);
	const [_importFile, setImportFile] = createSignal<File | null>(null);
	const [importing, setImporting] = createSignal(false);
	const [importDefaultTags, setImportDefaultTags] = createSignal("");
	const [importResult, setImportResult] = createSignal<{
		imported: number;
		errors: string[];
	} | null>(null);

	interface PreviewRow {
		cue: string;
		target: string;
		tags: string[];
		selected: boolean;
	}
	const [previewRows, setPreviewRows] = createSignal<PreviewRow[]>([]);
	const [parseError, setParseError] = createSignal("");

	const selectedCount = createMemo(
		() => previewRows().filter((r) => r.selected).length,
	);

	async function parseFile(file: File): Promise<PreviewRow[]> {
		const text = await file.text();
		if (file.name.endsWith(".json")) {
			const json = JSON.parse(text);
			const items = Array.isArray(json) ? json : (json.mems ?? []);
			return items.map(
				(i: { cue?: string; target?: string; tags?: string[] }) => ({
					cue: (i.cue ?? "").trim(),
					target: (i.target ?? "").trim(),
					tags: i.tags ?? [],
					selected: true,
				}),
			);
		}
		// CSV 解析
		const lines = text
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
		if (lines.length === 0) return [];
		// 跳过表头
		const header = lines[0].toLowerCase();
		const hasHeader =
			header.includes("cue") ||
			header.includes("target") ||
			header.includes("tags");
		const dataLines = hasHeader ? lines.slice(1) : lines;

		return dataLines
			.map((line) => {
				// 简单 CSV 解析（支持引号）
				const fields: string[] = [];
				let current = "";
				let inQuote = false;
				for (const ch of line) {
					if (ch === '"') {
						inQuote = !inQuote;
						continue;
					}
					if (ch === "," && !inQuote) {
						fields.push(current.trim());
						current = "";
						continue;
					}
					current += ch;
				}
				fields.push(current.trim());
				const cue = fields[0] ?? "";
				const target = fields[1] ?? "";
				const tags = (fields[2] ?? "")
					.split(/[;,]/)
					.map((s) => s.trim())
					.filter(Boolean);
				return { cue, target, tags, selected: true };
			})
			.filter((r) => r.cue && r.target);
	}

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
					<button
						type="button"
						class={mode() === "csv" ? styles.modeActive : styles.modeBtn}
						onClick={() => setMode("csv")}
					>
						导入
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
							onClick={() => navigate("/m")}
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
					<div class={styles.formatBlock}>
						<p class={styles.formatName}>JSON 格式</p>
						<pre class={styles.formatExample}>{`[
  { "cue": "质能方程", "target": "E=mc²", "tags": ["物理", "公式"] },
  { "cue": "光速", "target": "299792458 m/s" }
]`}</pre>
						<p class={styles.formatNote}>
							<code>tags</code> 可选，可省略。也可包装为{" "}
							<code>{'{"mems": [...]}'}</code>
						</p>
					</div>
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
							onClick={() => navigate("/m")}
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

				<Show when={mode() === "csv"}>
					<Show when={importResult()}>
						<div class={styles.importResult}>
							<p>已导入 {importResult()!.imported} 条记忆</p>
							<Show when={(importResult()?.errors.length ?? 0) > 0}>
								<p class={styles.importErrors}>错误：</p>
								<ul class={styles.importErrorList}>
									<For each={importResult()!.errors}>{(e) => <li>{e}</li>}</For>
								</ul>
							</Show>
							<button
								type="button"
								class={styles.submit}
								onClick={() => {
									setImportResult(null);
									setImportFile(null);
								}}
							>
								继续导入
							</button>
						</div>
					</Show>
					<Show when={!importResult()}>
						<div class={styles.formatHint}>
							<p class={styles.hintTitle}>支持的文件格式</p>
							<div class={styles.formatBlock}>
								<p class={styles.formatName}>CSV</p>
								<pre class={styles.formatExample}>
									cue,target,tags
									<br />
									质能方程,E=mc²,物理;公式
									<br />
									光速,299792458 m/s,物理
									<br />
									DNA,双螺旋结构,生物;遗传
								</pre>
								<p class={styles.formatNote}>
									标签可用 <code>;</code> 或 <code>,</code>{" "}
									分隔，内容含逗号请用引号
								</p>
							</div>
							{/*<div class={styles.formatBlock}>
								<p class={styles.formatName}>JSON</p>
								<pre class={styles.formatExample}>{`[
  { "cue": "质能方程", "target": "E=mc²", "tags": ["物理", "公式"] },
  { "cue": "光速", "target": "299792458 m/s" }
]`}</pre>
								<p class={styles.formatNote}>或包装为 {`{ "mems": [...] }`}。无标签可省略 <code>tags</code> 字段</p>
							</div>*/}
						</div>
						<input
							type="file"
							accept=".csv,.json"
							class={styles.fileInput}
							onChange={async (e) => {
								const file = e.currentTarget.files?.[0] ?? null;
								setImportFile(file);
								if (file) {
									try {
										const rows = await parseFile(file);
										setPreviewRows(rows);
										setParseError("");
									} catch (err) {
										setParseError(String(err));
										setPreviewRows([]);
									}
								} else {
									setPreviewRows([]);
								}
							}}
						/>
						<Show when={parseError()}>
							<p class={styles.importErrors}>{parseError()}</p>
						</Show>
						<Show when={previewRows().length > 0}>
							<div class={styles.previewTable}>
								<table>
									<thead>
										<tr>
											<th class={styles.previewTh}>
												<input
													type="checkbox"
													checked={selectedCount() === previewRows().length}
													onChange={() => {
														const all =
															selectedCount() === previewRows().length;
														setPreviewRows((prev) =>
															prev.map((r) => ({ ...r, selected: !all })),
														);
													}}
												/>
											</th>
											<th class={styles.previewTh}>线索</th>
											<th class={styles.previewTh}>答案</th>
											<th class={styles.previewTh}>标签</th>
										</tr>
									</thead>
									<tbody>
										<For each={previewRows()}>
											{(row, i) => (
												<tr>
													<td class={styles.previewTd}>
														<input
															type="checkbox"
															checked={row.selected}
															onChange={() =>
																setPreviewRows((prev) => {
																	const next = [...prev];
																	next[i()] = {
																		...next[i()],
																		selected: !next[i()].selected,
																	};
																	return next;
																})
															}
														/>
													</td>
													<td class={styles.previewTd}>
														{row.cue.slice(0, 60)}
													</td>
													<td class={styles.previewTd}>
														{row.target.slice(0, 60)}
													</td>
													<td class={styles.previewTd}>
														<For each={row.tags}>
															{(tag) => (
																<span class={styles.previewTag}>{tag}</span>
															)}
														</For>
													</td>
												</tr>
											)}
										</For>
									</tbody>
								</table>
							</div>
							<p class={styles.previewCount}>
								已选 {selectedCount()} / 共 {previewRows().length} 条
							</p>
						</Show>
						<div class={styles.formGroup}>
							<label for="import-default-tags" class={styles.label}>
								默认标签（可选）
							</label>
							<input
								id="import-default-tags"
								type="text"
								class={styles.textInput}
								placeholder="标签1; 标签2"
								value={importDefaultTags()}
								onInput={(e) => setImportDefaultTags(e.currentTarget.value)}
							/>
						</div>
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
								onClick={async () => {
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
								}}
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
