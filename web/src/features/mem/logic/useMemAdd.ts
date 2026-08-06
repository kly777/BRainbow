// ── 记忆添加模块的核心业务逻辑 ──

import { useNavigate, useSearchParams } from "@solidjs/router";
import { createMemo, createSignal } from "solid-js";
import { showToast } from "@components/ui/toastStore.ts";
import { parseBatch, parseImportFile } from "@lib/delimited.ts";
import { tryAsync, trySync } from "@lib/result.ts";
import { tryOrNotify } from "@lib/safe-action.ts";
import { importJsonE } from "@features/mem/api.ts";

// ── 类型 ──

export interface PreviewRow {
	cue: string;
	target: string;
	tags: string[];
	selected: boolean;
}

export type AddMode = "single" | "paste" | "file";
const VALID_MODES: AddMode[] = ["single", "paste", "file"];

// ── Hook ──

export function useMemAdd() {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();

	// ── 模式 ──
	const mode = (): AddMode => {
		const m = searchParams.mode;
		return typeof m === "string" && VALID_MODES.includes(m as AddMode)
			? (m as AddMode)
			: "single";
	};
	const setMode = (m: AddMode) =>
		setSearchParams({ mode: m === "single" ? undefined : m });

	// ── 单条创建 ──
	const [cue, setCue] = createSignal("");
	const [target, setTarget] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	// ── 批量 / 文件共享状态 ──
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
		const { createMemE } = await import("@features/mem/api.ts");
		const ok = await tryOrNotify(
			() => createMemE(cue().trim(), target().trim()),
			"创建记忆",
		);
		if (ok) {
			setCue("");
			setTarget("");
		}
		setCreating(false);
	};

	// ── 解析批量文本 ──
	function parsePasteText(text: string): PreviewRow[] {
		const trimmed = text.trim();
		if (!trimmed) return [];
		if (trimmed.startsWith("[")) {
			const result = trySync(() => {
				const items = JSON.parse(trimmed);
				return (Array.isArray(items) ? items : [])
					.map((i: { cue?: string; target?: string; tags?: string[] }) => ({
						cue: (i.cue ?? "").trim(),
						target: (i.target ?? "").trim(),
						tags: i.tags ?? [],
						selected: true,
					}))
					.filter((r: PreviewRow) => r.cue && r.target);
			});
			if (result.ok) return result.value;
			// JSON 解析失败 → fallthrough 到分隔符解析
		}
		return parseBatch(trimmed).map((p) => ({ ...p, tags: [], selected: true }));
	}

	// ── 导入执行 ──
	const doImport = async (rows: PreviewRow[]) => {
		setImporting(true);
		const tags = importDefaultTags()
			.split(/[;,]/)
			.map((s) => s.trim())
			.filter(Boolean);
		const mems = rows.map((r) => ({
			cue: r.cue,
			target: r.target,
			tags: r.tags,
		}));
		const result = await tryAsync(() =>
			importJsonE(mems, tags.length > 0 ? tags : undefined),
		);
		if (result.ok) {
			setImportResult(result.value);
		} else {
			showToast({
				type: "error",
				title: "导入失败",
				message: result.error.message,
				duration: 5000,
			});
		}
		setImporting(false);
	};

	const handlePasteImport = async () => {
		const rows = previewRows().filter((r) => r.selected);
		if (rows.length > 0) await doImport(rows);
	};

	const handleFileImport = async () => {
		const rows = previewRows().filter((r) => r.selected);
		if (rows.length > 0) await doImport(rows);
	};

	// ── 文件处理 ──
	async function handleFilePicked(file: File | null) {
		if (!file) {
			setPreviewRows([]);
			return;
		}
		const result = await tryAsync(async () => {
			const text = await file.text();
			return parseImportFile(text, file.name).map((r) => ({
				...r,
				selected: true,
			}));
		});
		if (result.ok) {
			setPreviewRows(result.value);
			setParseError("");
		} else {
			setParseError(result.error.message);
			setPreviewRows([]);
		}
	}

	// ── 重置 ──
	const resetImport = () => {
		setImportResult(null);
		setPreviewRows([]);
		setPasteText("");
		setImportDefaultTags("");
	};

	return {
		mode,
		setMode,
		cue,
		setCue,
		target,
		setTarget,
		creating,
		pasteText,
		setPasteText,
		previewRows,
		setPreviewRows,
		importing,
		importDefaultTags,
		setImportDefaultTags,
		importResult,
		parseError,
		selectedCount,
		handleCreate,
		parsePasteText,
		handlePasteImport,
		handleFilePicked,
		handleFileImport,
		resetImport,
		navigate,
	};
}
