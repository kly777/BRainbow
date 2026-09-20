import { ArrowRight, Check } from "@components/ui/icons";
import { getErrorMessage } from "@shared/api";
import { copyText, useCopyFlash } from "@shared/utils";
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

const FieldName: Component<{ name: string; colType: string; isPk: boolean }> = (
	props,
) => (
	<dt class={styles.fieldName}>
		<span class={props.isPk ? styles.fieldNamePk : undefined}>
			{props.name}
		</span>
		<span class={styles.fieldType}>{props.colType}</span>
	</dt>
);

const FieldValue: Component<{
	col: () => ColumnLike;
	text: () => string;
	copiedKey: () => string | undefined;
	onCopy: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
}> = (props) => {
	const preview = () =>
		props.col().ref_table
			? props.previewFor(props.col().ref_table ?? "", props.text())
			: "";
	return (
		<dd class={styles.fieldValue}>
			<pre class={styles.fieldPre}>{props.text()}</pre>
			<div class={styles.fieldActions}>
				<button
					type="button"
					class={styles.fieldBtn}
					title="复制该字段"
					onClick={() => void props.onCopy(props.col().name, props.text())}
				>
					{props.copiedKey() === props.col().name ? "已复制" : "复制"}
				</button>
				<Show when={props.col().ref_table}>
					<button
						type="button"
						class={styles.fieldBtn}
						onClick={() =>
							props.onJump(
								props.col().ref_table ?? "",
								props.col().ref_column ?? "id",
								props.text(),
							)
						}
					>
						跳转 <ArrowRight size={14} />
					</button>
				</Show>
			</div>
			<Show when={preview()}>
				<span class={styles.fieldPreview} title={preview()}>
					{preview()}
				</span>
			</Show>
		</dd>
	);
};

const FieldRow: Component<{
	col: () => ColumnLike;
	value: () => string | number | null | undefined;
	copiedKey: () => string | undefined;
	onCopy: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
}> = (props) => {
	const text = () => formatValue(props.value());
	return (
		<div class={styles.field}>
			<FieldName
				name={props.col().name}
				colType={props.col().col_type}
				isPk={false}
			/>
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
	copiedKey: () => string | undefined;
	copyError: () => string;
	onCopyRowJson: () => void;
	onCopyField: (key: string, text: string) => void;
	onJump: RowDetailProps["onJump"];
	previewFor: RowDetailProps["previewFor"];
	table: string;
	rowKey: string;
}> = (props) => (
	<div class={styles.body}>
		<div class={styles.bodyToolbar}>
			<button
				type="button"
				class={styles.copyBtn}
				onClick={() => void props.onCopyRowJson()}
			>
				{props.copiedKey() === "__row"
					? "已复制 <Check size={14} />"
					: "复制 JSON"}
			</button>
			<Show when={props.copyError()}>
				<span class={styles.copyError}>{props.copyError()}</span>
			</Show>
		</div>

		<dl class={styles.fields}>
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

		<div class={styles.backrefSection}>
			<h5 class={styles.backrefTitle}>反向引用</h5>
			<BackRefs
				table={props.table}
				rowKey={props.rowKey}
				onJump={props.onJump}
			/>
		</div>
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
	const { copiedKey, flash: flashCopied } = useCopyFlash();
	const [copyError, setCopyError] = createSignal("");

	const row = () => detail()?.rows[0];
	const header = () => detail()?.header ?? [];

	const copyField = async (key: string, text: string) => {
		setCopyError("");
		if (await copyText(text)) {
			flashCopied(key);
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
		props.table;
		props.rowKey;
		panelRef?.focus();
		const handler = (e: KeyboardEvent) => handleKeyDown(e);
		document.addEventListener("keydown", handler);
		onCleanup(() => document.removeEventListener("keydown", handler));
	});

	return (
		<div class={styles.overlay}>
			<button
				type="button"
				class={styles.backdrop}
				aria-label="关闭行详情"
				onClick={props.onClose}
			/>
			<aside
				ref={panelRef}
				class={styles.panel}
				role="dialog"
				aria-modal="true"
				aria-label={`${props.table} 行详情`}
				tabindex="-1"
			>
				<header class={styles.header}>
					<div class={styles.headerLeft}>
						<span class={styles.tableBadge}>{props.table}</span>
						<span class={styles.rowId}>#{props.rowKey}</span>
					</div>
					<button
						type="button"
						class={styles.closeBtn}
						title="关闭 (Esc)"
						onClick={props.onClose}
					>
						×
					</button>
				</header>

				<Show when={detail.loading}>
					<div class={styles.loading}>加载行详情…</div>
				</Show>
				<Show when={detail.error}>
					<div class={styles.error}>{getErrorMessage(detail.error)}</div>
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
