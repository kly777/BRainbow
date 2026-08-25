import { getErrorMessage } from "@lib/api";
import { copyText } from "@lib/utils";
import {
	type Component,
	createEffect,
	createResource,
	createSignal,
	Index,
	onCleanup,
	Show,
} from "solid-js";
import { getTableDataE } from "../api";
import BackRefs from "./BackRefs";
import styles from "./RowDetail.module.css";

interface RowDetailProps {
	table: string;
	pkCol: string;
	rowKey: string;
	previewFor: (table: string, value: string) => string;
	onJump: (targetTable: string, refCol: string, value: string) => void;
	onClose: () => void;
}

type ColumnLike = {
	readonly name: string;
	readonly col_type: string;
	readonly ref_table?: string | null;
	readonly ref_column?: string | null;
};

type RowValue = readonly (string | number | null)[];

const formatValue = (value: unknown): string => {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value, null, 2);
};

const FieldPreview: Component<{ summary: () => string }> = (props) => (
	<span class={styles.rowDetailPreview}>{props.summary()}</span>
);

const FieldName: Component<{ name: string; colType: string }> = (props) => (
	<dt class={styles.rowDetailFieldName}>
		<span>{props.name}</span>
		<span class={styles.rowDetailFieldType}>{props.colType}</span>
	</dt>
);

const FieldValue: Component<{
	col: () => ColumnLike;
	text: () => string;
	copiedKey: () => string;
	onCopy: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
}> = (props) => (
	<dd class={styles.rowDetailFieldValue}>
		<pre class={styles.rowDetailPre}>{props.text()}</pre>
		<button
			type="button"
			class={styles.rowDetailCopySmall}
			title="复制该字段"
			onClick={() => void props.onCopy(props.col().name, props.text())}
		>
			{props.copiedKey() === props.col().name ? "已复制" : "复制"}
		</button>
		<Show when={props.col().ref_table}>
			<button
				type="button"
				class={styles.rowDetailJump}
				onClick={() =>
					props.onJump(
						props.col().ref_table ?? "",
						props.col().ref_column ?? "id",
						props.text(),
					)
				}
			>
				跳转
			</button>
			<Show when={props.previewFor(props.col().ref_table ?? "", props.text())}>
				{(summary) => <FieldPreview summary={summary} />}
			</Show>
		</Show>
	</dd>
);

const FieldRow: Component<{
	col: () => ColumnLike;
	value: () => string | number | null | undefined;
	copiedKey: () => string;
	onCopy: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
}> = (props) => {
	const text = () => formatValue(props.value());
	return (
		<div class={styles.rowDetailField}>
			<FieldName name={props.col().name} colType={props.col().col_type} />
			<FieldValue
				col={props.col}
				text={text}
				copiedKey={props.copiedKey}
				onCopy={props.onCopy}
				onJump={props.onJump}
				previewFor={props.previewFor}
			/>
		</div>
	);
};

const RowDetailBody: Component<{
	row: () => RowValue | undefined;
	header: () => readonly ColumnLike[];
	copiedKey: () => string;
	copyError: () => string;
	onCopyRowJson: () => void;
	onCopyField: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
	table: string;
	rowKey: string;
}> = (props) => (
	<div class={styles.rowDetailBody}>
		<button
			type="button"
			class={styles.rowDetailCopy}
			onClick={() => void props.onCopyRowJson()}
		>
			{props.copiedKey() === "__row" ? "已复制 ✓" : "复制整行 JSON"}
		</button>
		{props.copyError() && (
			<div class={styles.rowDetailError}>{props.copyError()}</div>
		)}

		<dl class={styles.rowDetailFields}>
			<Index each={props.header()}>
				{(col, i) => {
					const value = () => props.row()?.[i];
					return (
						<FieldRow
							col={col}
							value={value}
							copiedKey={props.copiedKey}
							onCopy={props.onCopyField}
							onJump={props.onJump}
							previewFor={props.previewFor}
						/>
					);
				}}
			</Index>
		</dl>

		<h5 class={styles.rowDetailBackrefTitle}>反向引用</h5>
		<BackRefs table={props.table} rowKey={props.rowKey} onJump={props.onJump} />
	</div>
);

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

	const copyField = async (key: string, text: string) => {
		setCopyError("");
		if (await copyText(text)) {
			setCopiedKey(key);
			setTimeout(() => setCopiedKey(""), 1200);
		} else {
			setCopyError("复制失败");
		}
	};

	const copyRowJson = async () => {
		const data = detail();
		if (!data || !row()) return;
		const record: Record<string, unknown> = {};
		for (let i = 0; i < data.header.length; i++) {
			record[data.header[i].name] = data.rows[0][i] ?? null;
		}
		await copyField("__row", JSON.stringify(record, null, 2));
	};

	// Escape 关闭 + Tab 焦点陷阱
	let panelRef: HTMLElement | undefined;
	const handleKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			props.onClose();
			return;
		}
		if (e.key === "Tab" && panelRef) {
			const focusable = panelRef.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			if (focusable.length === 0) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey) {
				if (document.activeElement === first) {
					e.preventDefault();
					last.focus();
				}
			} else {
				if (document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		}
	};

	// 打开时自动聚焦面板、注册全局键盘事件
	createEffect(() => {
		// 触发依赖收集
		props.table;
		props.rowKey;
		panelRef?.focus();
		const handler = (e: KeyboardEvent) => handleKeyDown(e);
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	return (
		<div class={styles.rowDetailOverlay}>
			<button
				type="button"
				class={styles.rowDetailBackdrop}
				aria-label="关闭行详情"
				onClick={props.onClose}
			/>
			<aside
				ref={panelRef}
				class={styles.rowDetailPanel}
				role="dialog"
				aria-modal="true"
				aria-label={`${props.table} 行详情`}
				tabindex="-1"
			>
				<header class={styles.rowDetailHeader}>
					<h4 class={styles.rowDetailTitle}>
						{props.table} · #{props.rowKey}
					</h4>
					<button
						type="button"
						class={styles.rowDetailClose}
						title="关闭 (Esc)"
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
					<RowDetailBody
						row={row}
						header={header}
						copiedKey={copiedKey}
						copyError={copyError}
						onCopyRowJson={() => void copyRowJson()}
						onCopyField={(key, text) => void copyField(key, text)}
						onJump={props.onJump}
						previewFor={props.previewFor}
						table={props.table}
						rowKey={props.rowKey}
					/>
				</Show>
			</aside>
		</div>
	);
};

export default RowDetail;
