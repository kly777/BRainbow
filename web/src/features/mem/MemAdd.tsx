// ── 添加记忆页面（薄壳视图层）──

import { A } from "@solidjs/router";
import { For, Show } from "solid-js";
import MarkdownEditor from "../../components/ui/MarkdownEditor.tsx";
import { useMemAdd, type PreviewRow } from "./logic/useMemAdd.ts";
import styles from "./MemAdd.module.css";

export default function MemAdd() {
	const m = useMemAdd();

	return (
		<div class={styles.page}>
			<div class={styles.topBar}>
				<A href="/m" class={styles.backLink}>← 记忆</A>
				<h1 class={styles.title}>添加记忆</h1>
				<div class={styles.modeTabs}>
					{(["single", "paste", "file"] as const).map((mode) => (
						<button type="button"
							class={m.mode() === mode ? styles.modeActive : styles.modeBtn}
							onClick={() => m.setMode(mode)}>
							{mode === "single" ? "单条创建" : mode === "paste" ? "批量粘贴" : "从文件导入"}
						</button>
					))}
				</div>
			</div>

			<div class={styles.form}>
				<Show when={m.mode() === "single"}>
					<label class={styles.label} for="add-cue">线索（Markdown）</label>
					<MarkdownEditor id="add-cue" class={styles.textarea} placeholder="例如：质能方程 E=mc²"
						value={m.cue()} onInput={m.setCue} rows={4} />
					<label class={styles.label} for="add-target">答案（Markdown）</label>
					<MarkdownEditor id="add-target" class={styles.textarea} placeholder="例如：能量等于质量乘以光速的平方"
						value={m.target()} onInput={m.setTarget} rows={4} />
					<div class={styles.actions}>
						<button type="button" class={styles.cancel} onClick={() => m.navigate("/m")}>取消</button>
						<button type="button" class={styles.submit} onClick={m.handleCreate}
							disabled={m.creating() || !m.cue().trim() || !m.target().trim()}>
							{m.creating() ? "创建中..." : "创建"}
						</button>
					</div>
				</Show>

				<Show when={m.mode() === "paste"}>
					<PasteView m={m} />
				</Show>

				<Show when={m.mode() === "file"}>
					<FileView m={m} />
				</Show>
			</div>
		</div>
	);
}

// ── 批量粘贴视图 ──

function PasteView(props: { m: ReturnType<typeof useMemAdd> }) {
	const m = props.m;
	return (
		<Show when={m.importResult()} fallback={
			<>
				<FormatHint mode="paste" />
				<textarea class={styles.textarea} value={m.pasteText()} rows={8}
					placeholder={"质能方程 | E=mc²\n光速 | 299792458 m/s"}
					onInput={(e) => { m.setPasteText(e.currentTarget.value); m.setPreviewRows(m.parsePasteText(e.currentTarget.value)); }} />
				<Show when={m.previewRows().length > 0}>
					<ImportPreviewTable rows={m.previewRows()} selectedCount={m.selectedCount()}
						onToggle={(i) => m.setPreviewRows((prev) => { const n = [...prev]; n[i] = { ...n[i], selected: !n[i].selected }; return n; })}
						onToggleAll={() => { const all = m.selectedCount() === m.previewRows().length; m.setPreviewRows((prev) => prev.map((r) => ({ ...r, selected: !all }))); }} />
					<p class={styles.previewCount}>已选 {m.selectedCount()} / 共 {m.previewRows().length} 条</p>
				</Show>
				<ImportTagInput value={m.importDefaultTags()} onChange={m.setImportDefaultTags} />
				<div class={styles.actions}>
					<button type="button" class={styles.cancel} onClick={() => m.navigate("/m")}>取消</button>
					<button type="button" class={styles.submit} disabled={m.selectedCount() === 0 || m.importing()} onClick={m.handlePasteImport}>
						{m.importing() ? "导入中…" : `导入所选 (${m.selectedCount()} 条)`}
					</button>
				</div>
			</>
		}>
			<ImportResultPage result={m.importResult()!} onContinue={m.resetImport} />
		</Show>
	);
}

// ── 文件导入视图 ──

function FileView(props: { m: ReturnType<typeof useMemAdd> }) {
	const m = props.m;
	return (
		<Show when={m.importResult()} fallback={
			<>
				<FormatHint mode="file" />
				<label class={styles.label} for="import-file">选择文件</label>
				<input id="import-file" type="file" accept=".csv,.psv,.json" class={styles.fileInput}
					onChange={(e) => m.handleFilePicked(e.currentTarget.files?.[0] ?? null)} />
				<Show when={m.parseError()}><p class={styles.importErrors}>{m.parseError()}</p></Show>
				<Show when={m.previewRows().length > 0}>
					<ImportPreviewTable rows={m.previewRows()} selectedCount={m.selectedCount()}
						onToggle={(i) => m.setPreviewRows((prev) => { const n = [...prev]; n[i] = { ...n[i], selected: !n[i].selected }; return n; })}
						onToggleAll={() => { const all = m.selectedCount() === m.previewRows().length; m.setPreviewRows((prev) => prev.map((r) => ({ ...r, selected: !all }))); }} />
					<p class={styles.previewCount}>已选 {m.selectedCount()} / 共 {m.previewRows().length} 条</p>
				</Show>
				<ImportTagInput value={m.importDefaultTags()} onChange={m.setImportDefaultTags} />
				<div class={styles.actions}>
					<button type="button" class={styles.cancel} onClick={() => m.navigate("/m")}>取消</button>
					<button type="button" class={styles.submit} disabled={m.selectedCount() === 0 || m.importing()} onClick={m.handleFileImport}>
						{m.importing() ? "导入中…" : `导入所选 (${m.selectedCount()} 条)`}
					</button>
				</div>
			</>
		}>
			<ImportResultPage result={m.importResult()!} onContinue={m.resetImport} />
		</Show>
	);
}

// ── 通用子组件 ──

function FormatHint(props: { mode: "paste" | "file" }) {
	return (
		<div class={styles.formatHint}>
			{props.mode === "paste" && <>
				<p class={styles.hint}>支持两种格式（自动识别）：</p>
				<div class={styles.formatBlock}><p class={styles.formatName}>PSV（竖线分隔）</p>
					<pre class={styles.formatExample}>质能方程|E=mc²<br />光速|299792458 m/s</pre>
					<p class={styles.formatNote}>每行一条，用 <code>|</code> 或 <code>Tab</code> 分隔</p>
				</div>
				<div class={styles.formatBlock}><p class={styles.formatName}>JSON</p>
					<pre class={styles.formatExample}>{`[{"cue":"质能方程","target":"E=mc²"}]`}</pre>
					<p class={styles.formatNote}><code>tags</code> 可选</p>
				</div>
			</>}
			{props.mode === "file" && <>
				<p class={styles.hintTitle}>支持的文件格式</p>
				<div class={styles.formatBlock}>
					<p class={styles.formatName}>CSV（逗号分隔）</p>
					<pre class={styles.formatExample}>cue,target,tags<br />质能方程,E=mc²,物理;公式<br />光速,299792458 m/s,物理</pre>
					<p class={styles.formatNote}>内容含逗号请用引号包裹</p>
				</div>
				<div class={styles.formatBlock}>
					<p class={styles.formatName}>PSV（竖线分隔）</p>
					<pre class={styles.formatExample}>cue|target|tags<br />质能方程|E=mc²|物理;公式<br />光速|299792458 m/s|物理</pre>
					<p class={styles.formatNote}>导出默认格式，内容含逗号无需转义</p>
				</div>
				<div class={styles.formatBlock}>
					<p class={styles.formatName}>JSON</p>
					<pre class={styles.formatExample}>{`[{"cue":"质能方程","target":"E=mc²","tags":["物理"]}]`}</pre>
					<p class={styles.formatNote}>或包装为 <code>{'{"mems": [...]}'}</code></p>
				</div>
			</>}
		</div>
	);
}

function ImportPreviewTable(props: {
	rows: PreviewRow[]; selectedCount: number;
	onToggle: (i: number) => void; onToggleAll: () => void;
}) {
	return (
		<div class={styles.previewTable}>
			<table>
				<thead><tr>
					<th class={styles.previewTh}><input type="checkbox" checked={props.selectedCount === props.rows.length} onChange={props.onToggleAll} /></th>
					<th class={styles.previewTh}>线索</th>
					<th class={styles.previewTh}>答案</th>
					<th class={styles.previewTh}>标签</th>
				</tr></thead>
				<tbody><For each={props.rows}>{(row, i) => (
					<tr>
						<td class={styles.previewTd}><input type="checkbox" checked={row.selected} onChange={() => props.onToggle(i())} /></td>
						<td class={styles.previewTd}>{row.cue.slice(0, 60)}</td>
						<td class={styles.previewTd}>{row.target.slice(0, 60)}</td>
						<td class={styles.previewTd}><For each={row.tags}>{(tag) => <span class={styles.previewTag}>{tag}</span>}</For></td>
					</tr>
				)}</For></tbody>
			</table>
		</div>
	);
}

function ImportTagInput(props: { value: string; onChange: (v: string) => void }) {
	return (
		<div class={styles.formGroup}>
			<label for="import-default-tags" class={styles.label}>默认标签（可选，所有导入条目都会加上）</label>
			<input id="import-default-tags" type="text" class={styles.textInput}
				placeholder="标签1; 标签2" value={props.value} onInput={(e) => props.onChange(e.currentTarget.value)} />
		</div>
	);
}

function ImportResultPage(props: { result: { imported: number; errors: string[] }; onContinue: () => void }) {
	return (
		<div class={styles.importResult}>
			<p>已导入 {props.result.imported} 条记忆</p>
			<Show when={(props.result.errors.length ?? 0) > 0}>
				<p class={styles.importErrors}>错误：</p>
				<ul class={styles.importErrorList}><For each={props.result.errors}>{(e) => <li>{e}</li>}</For></ul>
			</Show>
			<button type="button" class={styles.submit} onClick={props.onContinue}>继续导入</button>
		</div>
	);
}
