import { Input } from "@components/ui";
import { ArrowLeft, Check, X } from "@components/ui/icons";
import { PATHS } from "@config/paths";
// ── v2 导入相关子组件：格式说明卡 / 预览清单 / 默认标签 / 结果页 ──

import { A } from "@solidjs/router";
import { type Component, For, Show } from "solid-js";
import type { PreviewRow } from "../hooks/useMemAdd.ts";
import styles from "./ImportParts.module.css";

// ── 格式说明（档案说明卡） ──

export function FormatHint(props: { mode: "paste" | "file" }) {
	return (
		<div class={styles.hintCard}>
			<div class={styles.hintTab}>
				<span class={styles.hintTabText}>格式说明</span>
			</div>
			<div class={styles.hintBody}>
				{props.mode === "paste" && (
					<>
						<p class={styles.hintLead}>支持两种格式（自动识别）：</p>
						<div class={styles.hintBlock}>
							<p class={styles.hintName}>PSV（竖线分隔）</p>
							<pre class={styles.hintExample}>
								质能方程|E=mc²
								<br />
								光速|299792458 m/s
							</pre>
							<p class={styles.hintNote}>
								每行一条，用 <code>|</code> 或 <code>Tab</code> 分隔
							</p>
						</div>
						<div class={styles.hintBlock}>
							<p class={styles.hintName}>JSON</p>
							<pre
								class={styles.hintExample}
							>{`[{"cue":"质能方程","target":"E=mc²"}]`}</pre>
							<p class={styles.hintNote}>
								<code>tags</code> 可选
							</p>
						</div>
					</>
				)}
				{props.mode === "file" && (
					<>
						<p class={styles.hintLead}>支持的文件格式</p>
						<div class={styles.hintBlock}>
							<p class={styles.hintName}>CSV（逗号分隔）</p>
							<pre class={styles.hintExample}>
								cue,target,tags
								<br />
								质能方程,E=mc²,物理;公式
								<br />
								光速,299792458 m/s,物理
							</pre>
							<p class={styles.hintNote}>内容含逗号请用引号包裹</p>
						</div>
						<div class={styles.hintBlock}>
							<p class={styles.hintName}>PSV（竖线分隔）</p>
							<pre class={styles.hintExample}>
								cue|target|tags
								<br />
								质能方程|E=mc²|物理;公式
								<br />
								光速|299792458 m/s|物理
							</pre>
							<p class={styles.hintNote}>导出默认格式，内容含逗号无需转义</p>
						</div>
						<div class={styles.hintBlock}>
							<p class={styles.hintName}>JSON</p>
							<pre
								class={styles.hintExample}
							>{`[{"cue":"质能方程","target":"E=mc²","tags":["物理"]}]`}</pre>
							<p class={styles.hintNote}>
								或包装为 <code>{'{"mems": [...]}'}</code>
							</p>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// ── 预览清单（待入库卡片） ──

const PreviewTableHead: Component<{
	allSelected: boolean;
	onToggleAll: () => void;
}> = (props) => (
	<thead>
		<tr>
			<th class={styles.previewTh}>
				<input
					type="checkbox"
					checked={props.allSelected}
					onChange={props.onToggleAll}
				/>
			</th>
			<th class={styles.previewTh}>线索</th>
			<th class={styles.previewTh}>答案</th>
			<th class={styles.previewTh}>标签</th>
		</tr>
	</thead>
);

const PreviewRowView: Component<{
	row: PreviewRow;
	index: () => number;
	onToggle: (i: number) => void;
}> = (props) => (
	<tr>
		<td class={styles.previewTd}>
			<input
				type="checkbox"
				checked={props.row.selected}
				onChange={() => props.onToggle(props.index())}
			/>
		</td>
		<td class={styles.previewTd}>{props.row.cue.slice(0, 60)}</td>
		<td class={styles.previewTd}>{props.row.target.slice(0, 60)}</td>
		<td class={styles.previewTd}>
			<For each={props.row.tags}>
				{(tag) => <span class={styles.previewTag}>{tag}</span>}
			</For>
		</td>
	</tr>
);

const PreviewTableBody: Component<{
	rows: PreviewRow[];
	onToggle: (i: number) => void;
}> = (props) => (
	<tbody>
		<For each={props.rows}>
			{(row, i) => (
				<PreviewRowView row={row} index={i} onToggle={props.onToggle} />
			)}
		</For>
	</tbody>
);

export function ImportPreviewTable(props: {
	rows: PreviewRow[];
	selectedCount: number;
	onToggle: (i: number) => void;
	onToggleAll: () => void;
}) {
	return (
		<div class={styles.previewCard}>
			<div class={styles.previewTab}>
				<span class={styles.previewTabText}>预览清单</span>
				<span class={styles.previewTabNo}>
					{props.selectedCount === props.rows.length
						? "全部选中"
						: `已选 ${props.selectedCount}`}
				</span>
			</div>
			<div class={styles.previewBody}>
				<table class={styles.previewTable}>
					<PreviewTableHead
						allSelected={props.selectedCount === props.rows.length}
						onToggleAll={props.onToggleAll}
					/>
					<PreviewTableBody rows={props.rows} onToggle={props.onToggle} />
				</table>
			</div>
		</div>
	);
}

// ── 默认标签输入 ──

export function ImportTagInput(props: {
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div class={styles.tagCard}>
			<label for="import-default-tags" class={styles.label}>
				默认标签（可选，所有导入条目都会加上）
			</label>
			<Input
				id="import-default-tags"
				type="text"
				placeholder="标签1; 标签2"
				value={props.value}
				onInput={(e) => props.onChange(e.currentTarget.value)}
				tone="bg"
			/>
		</div>
	);
}

// ── 导入结果页 ──

export function ImportResult(props: {
	result: { imported: number; errors: string[] };
	onContinue: () => void;
}) {
	return (
		<div class={styles.resultCard}>
			<div class={styles.resultMark}>
				<Check size={14} />
			</div>
			<p class={styles.resultTitle}>已导入 {props.result.imported} 条记忆</p>
			<Show when={(props.result.errors.length ?? 0) > 0}>
				<p class={styles.importErrors}>错误：</p>
				<ul class={styles.importErrorList}>
					<For each={props.result.errors}>{(e) => <li>{e}</li>}</For>
				</ul>
			</Show>
			<div class={styles.resultActions}>
				<button type="button" class={styles.cancel} onClick={props.onContinue}>
					继续导入
				</button>
				<A href={PATHS.memory} class={styles.submit}>
					去复习
				</A>
			</div>
		</div>
	);
}

// ═══════════════════════════════════════════════
// 导入操作栏（取消 + 提交按钮，paste/file/ai 共用）
// ═══════════════════════════════════════════════

export function ImportActions(props: {
	onCancel: () => void;
	onSubmit: () => void;
	loading?: boolean;
	disabled?: boolean;
	submitLabel?: string;
}) {
	return (
		<div class={styles.actions}>
			<button type="button" class={styles.cancel} onClick={props.onCancel}>
				取消
			</button>
			<button
				type="button"
				class={styles.submit}
				disabled={props.disabled || props.loading}
				onClick={props.onSubmit}
			>
				{props.loading ? "导入中…" : (props.submitLabel ?? "导入")}
			</button>
		</div>
	);
}
