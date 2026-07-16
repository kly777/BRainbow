// ── 阅读详情页核心逻辑 ──
import type { ArticleDetail } from "../../../apis/readingApi.ts";

import { useParams } from "@solidjs/router";
import { createEffect, createMemo, createResource, createSignal } from "solid-js";
import { getArticle, getArticleNotes, markWord, recommendNext, updateArticleNotes } from "../../../apis/readingApi.ts";

export function useReadingDetail() {
	const params = useParams();
	const id = () => Number(params.id);

	const [detail, { refetch }] = createResource<ArticleDetail, number>(id, getArticle);
	const [recommended] = createResource<{ recommended: { id: number; title: string; known_ratio: number } | null }, number>(id, recommendNext);

	// 笔记
	const [notes, setNotes] = createSignal("");
	const [notesLoaded, setNotesLoaded] = createSignal(false);
	createEffect(() => {
		if (detail() && !notesLoaded()) {
			document.title = `${detail()!.article.title} · Brainbow`;
			getArticleNotes(id()).then((r: { notes: string }) => { setNotes(r.notes); setNotesLoaded(true); });
		}
	});

	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	const handleNotesBlur = () => {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => updateArticleNotes(id(), notes()), 300);
	};

	// 乐观更新
	const [localStatus, setLocalStatus] = createSignal<Map<string, "known" | "unknown" | "ignored">>(new Map());
	const wordStatusMap = createMemo(() => {
		const map = new Map<string, "known" | "unknown" | "ignored">();
		for (const w of detail()?.words ?? []) map.set(w.word, w.status as "known" | "unknown" | "ignored");
		for (const [word, status] of localStatus()) map.set(word, status);
		return map;
	});

	const sortedWords = createMemo(() => {
		const order: Record<string, number> = { unknown: 0, ignored: 1, known: 2 };
		const map = wordStatusMap();
		return [...(detail()?.words ?? [])].sort((a, b) => (order[map.get(a.word) ?? "known"] ?? 2) - (order[map.get(b.word) ?? "known"] ?? 2));
	});

	const handleMark = async (word: string, status: "known" | "unknown" | "ignored") => {
		const prev = localStatus();
		setLocalStatus((p) => new Map(p).set(word, status));
		try { await markWord(word, status); } catch { setLocalStatus(prev); return; }
		refetch();
	};

	// 单击/双击 debounce
	let clickTimer: ReturnType<typeof setTimeout> | undefined;
	const handleWordClick = (word: string) => {
		if (clickTimer) { clearTimeout(clickTimer); clickTimer = undefined; handleMark(word, "unknown"); return; }
		clickTimer = setTimeout(() => { clickTimer = undefined; handleMark(word, "known"); }, 250);
	};

	const handleContentClick = (e: MouseEvent) => {
		const word = (e.target as HTMLElement).dataset.word;
		if (word) handleWordClick(word);
	};

	const handleContentContextMenu = (e: MouseEvent) => {
		const word = (e.target as HTMLElement).dataset.word;
		if (word) { e.preventDefault(); handleMark(word, "ignored"); }
	};

	const [uploadingUnknown, setUploadingUnknown] = createSignal(false);
	const handleUploadUnknown = async () => {
		const unknownWords: string[] = [];
		const map = wordStatusMap();
		for (const w of detail()?.words ?? []) if (map.get(w.word) === "unknown") unknownWords.push(w.word);
		if (unknownWords.length === 0) return;
		setUploadingUnknown(true);
		try { await Promise.all(unknownWords.map((w) => markWord(w, "unknown"))); refetch(); }
		finally { setUploadingUnknown(false); }
	};

	const handleCopyUnknown = async () => {
		const unknownWords: string[] = [];
		const map = wordStatusMap();
		for (const w of detail()?.words ?? []) if (map.get(w.word) === "unknown") unknownWords.push(w.word);
		const text = [unknownWords.join("\n"), notes().trim()].filter(Boolean).join("\n\n");
		if (text) await navigator.clipboard.writeText(text);
	};

	return {
		detail, recommended, notes, setNotes, notesLoaded, handleNotesBlur,
		wordStatusMap, sortedWords, handleMark,
		handleContentClick, handleContentContextMenu,
		uploadingUnknown, handleUploadUnknown, handleCopyUnknown,
	};
}
