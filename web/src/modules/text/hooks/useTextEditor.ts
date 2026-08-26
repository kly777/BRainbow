import { notifyError, numParam, tryAsync, useUrlParams } from "@shared/utils";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { loadTextE, saveTextE } from "../api";

let _saveTimer: ReturnType<typeof setInterval> | null = null;

export type TextTab = { id: number; name: string; content: string };

async function load(): Promise<TextTab[]> {
	const result = await tryAsync(() => loadTextE());
	if (result.ok && result.value.tabs.length > 0) {
		return result.value.tabs.map((t) => ({
			id: t.id,
			name: t.name,
			content: t.content,
		}));
	}
	if (!result.ok) notifyError("加载文本失败", result.error);
	return [
		{ id: 0, name: "笔记 1", content: "" },
		{ id: 0, name: "笔记 2", content: "" },
		{ id: 0, name: "笔记 3", content: "" },
	];
}

async function save(tabs: { name: string; content: string }[]): Promise<void> {
	const result = await tryAsync(() => saveTextE(tabs));
	if (!result.ok) notifyError("自动保存文本失败", result.error);
}

function defaultName(i: number): string {
	return `笔记 ${i + 1}`;
}

export interface TextEditorApi {
	tabs: () => TextTab[];
	active: () => number;
	editing: () => number;
	editValue: () => string;
	setEditValue: (value: string) => void;
	selectTab: (i: number) => void;
	addTab: () => void;
	removeTab: (i: number) => void;
	startRename: (i: number) => void;
	commitRename: (i: number) => void;
	cancelRename: () => void;
	onTextInput: (value: string) => void;
	bindEditInput: (el: HTMLInputElement) => void;
}

export function useTextEditor(): TextEditorApi {
	const [active, setActive] = createSignal(0);
	const [tabs, setTabs] = createSignal<TextTab[]>([]);
	const [editing, setEditing] = createSignal(-1);
	const [editValue, setEditValue] = createSignal("");
	const urlParams = useUrlParams({
		tab: numParam(1, { min: 1 }),
		id: numParam(0, { min: 0 }),
	});

	let dirty = false;
	let editInputRef: HTMLInputElement | null = null;

	const selectTab = (i: number) => {
		const next = Math.min(Math.max(i, 0), Math.max(tabs().length - 1, 0));
		setActive(next);
		urlParams.set({ tab: next + 1 }, { replace: true });
	};

	createEffect(() => {
		const list = tabs();
		if (list.length === 0) return;
		const urlId = urlParams.get("id");
		let fromUrl = urlParams.get("tab") - 1;
		if (urlId > 0) {
			const idx = list.findIndex((t) => t.id === urlId);
			if (idx >= 0) {
				fromUrl = idx;
				urlParams.set({ id: undefined, tab: idx + 1 }, { replace: true });
			} else {
				urlParams.set({ id: undefined }, { replace: true });
			}
		}
		const next = Math.min(Math.max(fromUrl, 0), list.length - 1);
		if (active() !== next) setActive(next);
		if (fromUrl !== next) {
			urlParams.set({ tab: next + 1 }, { replace: true });
		}
	});

	const doSave = async () => {
		if (!dirty) return;
		dirty = false;
		await save(tabs());
	};

	const markDirty = () => {
		dirty = true;
	};

	onMount(async () => {
		setTabs(await load());
		_saveTimer = setInterval(() => void doSave(), 1000);
	});

	onCleanup(() => {
		if (_saveTimer) clearInterval(_saveTimer);
		void doSave();
	});

	const addTab = () => {
		const n = tabs().length;
		setTabs((prev) => [...prev, { id: 0, name: defaultName(n), content: "" }]);
		selectTab(n);
		markDirty();
	};

	const removeTab = (i: number) => {
		if (tabs().length <= 1) return;
		setTabs((prev) => prev.filter((_, j) => j !== i));
		const next =
			active() > i
				? active() - 1
				: active() === i && active() > 0
					? active() - 1
					: active();
		selectTab(next);
		markDirty();
	};

	const startRename = (i: number) => {
		setEditing(i);
		setEditValue(tabs()[i]?.name ?? defaultName(i));
		setTimeout(() => editInputRef?.focus(), 0);
	};

	const commitRename = (i: number) => {
		const v = editValue().trim();
		if (v) {
			setTabs((prev) => prev.map((t, j) => (j === i ? { ...t, name: v } : t)));
			markDirty();
		}
		setEditing(-1);
	};

	const cancelRename = () => setEditing(-1);

	const onTextInput = (value: string) => {
		markDirty();
		setTabs((prev) =>
			prev.map((t, i) => (i === active() ? { ...t, content: value } : t)),
		);
	};

	const bindEditInput = (el: HTMLInputElement) => {
		editInputRef = el;
	};

	return {
		tabs,
		active,
		editing,
		editValue,
		setEditValue,
		selectTab,
		addTab,
		removeTab,
		startRename,
		commitRename,
		cancelRename,
		onTextInput,
		bindEditInput,
	};
}
