import { notifyError, numParam, tryAsync, useUrlParams } from "@lib/utils";
import { createEffect, createSignal, For, onCleanup, onMount } from "solid-js";
import { loadTextE, saveTextE } from "./api";
import styles from "./TextEditor.module.css";

let _saveTimer: ReturnType<typeof setInterval> | null = null;

type Tab = { id: number; name: string; content: string };

async function load(): Promise<Tab[]> {
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

export default function TextEditor() {
	const [active, setActive] = createSignal(0);
	const [tabs, setTabs] = createSignal<Tab[]>([]);
	const [editing, setEditing] = createSignal(-1);
	const [editValue, setEditValue] = createSignal("");
	const urlParams = useUrlParams({
		tab: numParam(1, { min: 1 }),
		id: numParam(0, { min: 0 }),
	});

	const selectTab = (i: number) => {
		const next = Math.min(Math.max(i, 0), Math.max(tabs().length - 1, 0));
		setActive(next);
		urlParams.set({ tab: next + 1 }, { replace: true });
	};

	// URL 是 tab 的持久化来源：加载/前进后退/增删 tab 后都按 URL 收敛。
	// 支持全局搜索直达：?id=<text_note.id> 定位到对应 tab 后归一化为 tab 序号。
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

	let dirty = false;
	let editInputRef!: HTMLInputElement;

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
		_saveTimer = setInterval(doSave, 1000);
	});

	onCleanup(() => {
		if (_saveTimer) clearInterval(_saveTimer);
		doSave();
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

	return (
		<div class={styles.page}>
			<div class={styles.tabs} role="tablist">
				<For each={tabs()}>
					{(tab, i) => (
						<div
							role="tab"
							tabIndex={active() === i() ? 0 : -1}
							aria-selected={active() === i()}
							classList={{
								[styles.tab]: true,
								[styles.tabActive]: active() === i(),
							}}
							onClick={() => selectTab(i())}
							onDblClick={() => startRename(i())}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									selectTab(i());
								}
								if (e.key === "ArrowLeft") {
									e.preventDefault();
									selectTab((i() - 1 + tabs().length) % tabs().length);
								}
								if (e.key === "ArrowRight") {
									e.preventDefault();
									selectTab((i() + 1) % tabs().length);
								}
							}}
						>
							{editing() === i() ? (
								<input
									ref={editInputRef}
									class={styles.renameInput}
									aria-label="重命名标签"
									value={editValue()}
									onInput={(e) => setEditValue(e.currentTarget.value)}
									onBlur={() => commitRename(i())}
									onKeyDown={(e) => {
										if (e.key === "Enter") commitRename(i());
										if (e.key === "Escape") cancelRename();
										e.stopPropagation();
									}}
									onClick={(e) => e.stopPropagation()}
								/>
							) : (
								<span>{tab.name}</span>
							)}
							<button
								type="button"
								class={styles.closeBtn}
								onClick={(e) => {
									e.stopPropagation();
									removeTab(i());
								}}
								disabled={tabs().length <= 1}
								aria-label={`关闭 ${tab.name}`}
							>
								×
							</button>
						</div>
					)}
				</For>
				<button
					type="button"
					class={styles.addBtn}
					onClick={addTab}
					aria-label="新建标签"
				>
					+
				</button>
			</div>
			<textarea
				class={styles.editor}
				value={tabs()[active()]?.content ?? ""}
				onInput={(e) => {
					markDirty();
					setTabs((prev) =>
						prev.map((t, i) =>
							i === active() ? { ...t, content: e.currentTarget.value } : t,
						),
					);
				}}
				placeholder="在这里输入…"
				spellcheck={false}
			/>
		</div>
	);
}
