// ── v2 导入相关子组件：格式说明卡 / 预览清单 / 默认标签 / 结果页 ──

import { For, Show } from "solid-js";
import type { PreviewRow } from "@features/mem/logic/useMemAdd.ts";
import * as styles from "@features/mem/ui/ImportParts.css.ts";

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
							<pre class={styles.hintExample}>{`[{"cue":"质能方程","target":"E=mc²"}]`}</pre>
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
							<pre class={styles.hintExample}>{`[{"cue":"质能方程","target":"E=mc²","tags":["物理"]}]`}</pre>
							<p class={styles.hintNote}>
								或包装为 <code>{"{\"mems\": [...]}"}</code>
							</p>
						</div>
					</>
				)}
			</div>
		</div>
	);
}

// ── 预览清单（待入库卡片） ──

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

// ── 导入结果页 ──

export function ImportResult(props: {
	result: { imported: number; errors: string[] };
	onContinue: () => void;
}) {
	return (
		<div class={styles.resultCard}>
			<div class={styles.resultMark}>✓</div>
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
				<a href="/m" class={styles.submit}>
					去复习
				</a>
			</div>
		</div>
	);
}
