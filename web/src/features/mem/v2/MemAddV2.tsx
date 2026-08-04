// ── 添加记忆 v2：折痕卡片 ──
// 单条模式 = 摊开一张空白目录卡（线索/答案中间是折痕）
// 批量/文件模式 = 卡片清单审查（预览 + 勾选入库）
// 业务逻辑复用 useMemAdd，此处只做视图层

import { A } from "@solidjs/router";
import { createSignal, For, Show } from "solid-js";
import MarkdownEditor from "../../../components/ui/MarkdownEditor.tsx";
import { useMemAdd } from "../logic/useMemAdd.ts";
import * as styles from "./MemAddV2.css.ts";
import { FormatHintV2, ImportPreviewTableV2, ImportTagInputV2, ImportResultV2 } from "./ui/V2ImportParts.tsx";

export default function MemAddV2() {
	const m = useMemAdd();

	return (
		<div class={styles.page}>
			{/* 头栏 */}
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>
					← 记忆
				</A>
				<h1 class={styles.title}>添加记忆</h1>
				<div class={styles.modeTabs}>
					{(["single", "paste", "file"] as const).map((mode) => (
						<button
							type="button"
							class={m.mode() === mode ? styles.modeActive : styles.modeBtn}
							onClick={() => m.setMode(mode)}
						>
							{mode === "single"
								? "单条创建"
								: mode === "paste"
									? "批量粘贴"
									: "从文件导入"}
						</button>
					))}
				</div>
			</div>

			<div class={styles.content}>
				<Show when={m.mode() === "single"}>
					{/* ── 单条模式：折痕卡片 ── */}
					<div class={styles.cardWrap}>
						<div class={styles.card}>
							{/* 正面：线索 */}
							<div class={styles.face}>
								<div class={styles.faceTab}>
									<span class={styles.faceTabText}>线索</span>
									<span class={styles.faceTabNo}>正面</span>
								</div>
								<div class={styles.faceBody}>
									<MarkdownEditor
										id="add-cue"
										class={styles.textarea}
										placeholder="例如：质能方程 E=mc²"
										value={m.cue()}
										onInput={m.setCue}
										rows={4}
									/>
								</div>
							</div>

							{/* 折痕 */}
							<div class={styles.fold}>
								<span class={styles.foldMark} />
							</div>

							{/* 背面：答案 */}
							<div class={styles.face}>
								<div class={styles.faceTab}>
									<span class={styles.faceTabText}>答案</span>
									<span class={styles.faceTabNo}>背面</span>
								</div>
								<div class={styles.faceBody}>
									<MarkdownEditor
										id="add-target"
										class={styles.textarea}
										placeholder="例如：能量等于质量乘以光速的平方"
										value={m.target()}
										onInput={m.setTarget}
										rows={4}
									/>
								</div>
							</div>
						</div>

						<div class={styles.actions}>
							<button
								type="button"
								class={styles.cancel}
								onClick={() => m.navigate("/m")}
							>
								取消
							</button>
							<button
								type="button"
								class={styles.submit}
								onClick={m.handleCreate}
								disabled={
									m.creating() || !m.cue().trim() || !m.target().trim()
								}
							>
								{m.creating() ? "创建中..." : "创建"}
							</button>
						</div>
					</div>
				</Show>

				<Show when={m.mode() === "paste"}>
					<PasteViewV2 m={m} />
				</Show>

				<Show when={m.mode() === "file"}>
					<FileViewV2 m={m} />
				</Show>
			</div>
		</div>
	);
}

// ── 批量粘贴视图 ──

function PasteViewV2(props: { m: ReturnType<typeof useMemAdd> }) {
	const m = props.m;
	return (
		<Show
			when={m.importResult()}
			fallback={
				<div class={styles.stack}>
					<FormatHintV2 mode="paste" />
					<div class={styles.inputCard}>
						<textarea
							class={styles.textarea}
							value={m.pasteText()}
							rows={8}
							placeholder={"质能方程 | E=mc²\n光速 | 299792458 m/s"}
							onInput={(e) => {
								m.setPasteText(e.currentTarget.value);
								m.setPreviewRows(m.parsePasteText(e.currentTarget.value));
							}}
						/>
					</div>
					<Show when={m.previewRows().length > 0}>
						<ImportPreviewTableV2
							rows={m.previewRows()}
							selectedCount={m.selectedCount()}
							onToggle={(i) =>
								m.setPreviewRows((prev) => {
									const n = [...prev];
									n[i] = { ...n[i], selected: !n[i].selected };
									return n;
								})
							}
							onToggleAll={() => {
								const all = m.selectedCount() === m.previewRows().length;
								m.setPreviewRows((prev) =>
									prev.map((r) => ({ ...r, selected: !all })),
								);
							}}
						/>
						<p class={styles.previewCount}>
							已选 {m.selectedCount()} / 共 {m.previewRows().length} 条
						</p>
					</Show>
					<ImportTagInputV2
						value={m.importDefaultTags()}
						onChange={m.setImportDefaultTags}
					/>
					<div class={styles.actions}>
						<button
							type="button"
							class={styles.cancel}
							onClick={() => m.navigate("/m")}
						>
							取消
						</button>
						<button
							type="button"
							class={styles.submit}
							disabled={m.selectedCount() === 0 || m.importing()}
							onClick={m.handlePasteImport}
						>
							{m.importing()
								? "导入中…"
								: `导入所选 (${m.selectedCount()} 条)`}
						</button>
					</div>
				</div>
			}
		>
			<ImportResultV2 result={m.importResult()!} onContinue={m.resetImport} />
		</Show>
	);
}

// ── 文件导入视图 ──

function FileViewV2(props: { m: ReturnType<typeof useMemAdd> }) {
	const m = props.m;
	// 本地文件名状态，仅用于展示已选文件
	const [fileName, setFileName] = createSignal("");
	return (
		<Show
			when={m.importResult()}
			fallback={
				<div class={styles.stack}>
					<FormatHintV2 mode="file" />
					<div class={styles.inputCard}>
						<label for="import-file" class={styles.fileBtn}>
							📄 {fileName() || "选择文件"}
						</label>
						<input
							id="import-file"
							type="file"
							accept=".csv,.psv,.json"
							class={styles.fileInputHidden}
							onChange={(e) => {
								setFileName(e.currentTarget.files?.[0]?.name ?? "");
								m.handleFilePicked(e.currentTarget.files?.[0] ?? null);
							}}
						/>
						<Show when={m.parseError()}>
							<p class={styles.importErrors}>{m.parseError()}</p>
						</Show>
					</div>
					<Show when={m.previewRows().length > 0}>
						<ImportPreviewTableV2
							rows={m.previewRows()}
							selectedCount={m.selectedCount()}
							onToggle={(i) =>
								m.setPreviewRows((prev) => {
									const n = [...prev];
									n[i] = { ...n[i], selected: !n[i].selected };
									return n;
								})
							}
							onToggleAll={() => {
								const all = m.selectedCount() === m.previewRows().length;
								m.setPreviewRows((prev) =>
									prev.map((r) => ({ ...r, selected: !all })),
								);
							}}
						/>
						<p class={styles.previewCount}>
							已选 {m.selectedCount()} / 共 {m.previewRows().length} 条
						</p>
					</Show>
					<ImportTagInputV2
						value={m.importDefaultTags()}
						onChange={m.setImportDefaultTags}
					/>
					<div class={styles.actions}>
						<button
							type="button"
							class={styles.cancel}
							onClick={() => m.navigate("/m")}
						>
							取消
						</button>
						<button
							type="button"
							class={styles.submit}
							disabled={m.selectedCount() === 0 || m.importing()}
							onClick={m.handleFileImport}
						>
							{m.importing()
								? "导入中…"
								: `导入所选 (${m.selectedCount()} 条)`}
						</button>
					</div>
				</div>
			}
		>
			<ImportResultV2 result={m.importResult()!} onContinue={m.resetImport} />
		</Show>
	);
}
