import { getErrorMessage } from "@lib/api";
import { tryAsync } from "@lib/utils";
import {
	type Component,
	createResource,
	createSignal,
	Index,
	Show,
} from "solid-js";
import { getTableDataE } from "../api";
import styles from "../DbViewer.module.css";
import BackRefs from "./BackRefs";

interface RowDetailProps {
	table: string;
	pkCol: string;
	rowKey: string;
	previewFor: (table: string, value: string) => string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
	onClose: () => void;
}

const formatValue = (value: unknown): string => {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value, null, 2);
};

const RowDetail: Component<RowDetailProps> = (props) => {
	const [detail] = createResource(
		() => [props.table, props.pkCol, props.rowKey] as const,
		([table, pkCol, key]) => {
			const id = Number(key);
			if (!Number.isInteger(id) || id < 1) return Promise.resolve(null);
			return getTableDataE(table, {
				page: 1,
				page_size: 1,
				id,
				ref_col: pkCol,
			});
		},
	);
	const [copiedKey, setCopiedKey] = createSignal("");
	const [copyError, setCopyError] = createSignal("");

	const row = () => detail()?.rows[0];
	const header = () => detail()?.header ?? [];

	const copyText = async (key: string, text: string) => {
		setCopyError("");
		const result = await tryAsync(() => navigator.clipboard.writeText(text));
		if (result.ok) {
			setCopiedKey(key);
			setTimeout(() => setCopiedKey(""), 1200);
		} else {
			setCopyError(getErrorMessage(result.error));
		}
	};

	const copyRowJson = async () => {
		const data = detail();
		if (!data || !row()) return;
		const record: Record<string, unknown> = {};
		for (let i = 0; i < data.header.length; i++) {
			record[data.header[i].name] = data.rows[0][i] ?? null;
		}
		await copyText("__row", JSON.stringify(record, null, 2));
	};

	return (
		<div class={styles.rowDetailOverlay}>
			<button
				type="button"
				class={styles.rowDetailBackdrop}
				aria-label="关闭行详情"
				onClick={props.onClose}
			/>
			<aside
				class={styles.rowDetailPanel}
				role="dialog"
				aria-modal="true"
				aria-label={`${props.table} 行详情`}
			>
				<header class={styles.rowDetailHeader}>
					<h4 class={styles.rowDetailTitle}>
						{props.table} · #{props.rowKey}
					</h4>
					<button
						type="button"
						class={styles.rowDetailClose}
						title="关闭"
						onClick={props.onClose}
					>
						×
					</button>
				</header>

				<Show when={detail.loading}>
					<div class={styles.rowDetailLoading}>加载行详情…</div>
				</Show>
				<Show when={detail.error}>
					<div class={styles.rowDetailError}>
						{getErrorMessage(detail.error)}
					</div>
				</Show>
				<Show when={detail() && row()}>
					<div class={styles.rowDetailBody}>
						<button
							type="button"
							class={styles.rowDetailCopy}
							onClick={() => void copyRowJson()}
						>
							{copiedKey() === "__row" ? "已复制 ✓" : "复制整行 JSON"}
						</button>
						{copyError() && (
							<div class={styles.rowDetailError}>{copyError()}</div>
						)}

						<dl class={styles.rowDetailFields}>
							<Index each={header()}>
								{(col, i) => {
									const value = () => row()?.[i];
									const text = () => formatValue(value());
									return (
										<div class={styles.rowDetailField}>
											<dt class={styles.rowDetailFieldName}>
												<span>{col().name}</span>
												<span class={styles.rowDetailFieldType}>
													{col().col_type}
												</span>
											</dt>
											<dd class={styles.rowDetailFieldValue}>
												<pre class={styles.rowDetailPre}>{text()}</pre>
												<button
													type="button"
													class={styles.rowDetailCopySmall}
													title="复制该字段"
													onClick={() => void copyText(col().name, text())}
												>
													{copiedKey() === col().name ? "已复制" : "复制"}
												</button>
												<Show when={col().ref_table}>
													<button
														type="button"
														class={styles.rowDetailJump}
														onClick={() =>
															props.onJump(
																col().ref_table ?? "",
																col().ref_column ?? "id",
																text(),
															)
														}
													>
														跳转
													</button>
													<Show
														when={props.previewFor(
															col().ref_table ?? "",
															text(),
														)}
													>
														{(summary) => (
															<span class={styles.rowDetailPreview}>
																{summary()}
															</span>
														)}
													</Show>
												</Show>
											</dd>
										</div>
									);
								}}
							</Index>
						</dl>

						<h5 class={styles.rowDetailBackrefTitle}>反向引用</h5>
						<BackRefs
							table={props.table}
							rowKey={props.rowKey}
							onJump={props.onJump}
						/>
					</div>
				</Show>
			</aside>
		</div>
	);
};

export default RowDetail;
