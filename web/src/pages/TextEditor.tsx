import { createSignal, For, onCleanup, onMount } from "solid-js";
import { loadTextE, saveTextE } from "../apis/textApi.ts";
import styles from "./TextEditor.module.css";

let _saveTimer: ReturnType<typeof setInterval> | null = null;

async function load(): Promise<{ name: string; content: string }[]> {
	try {
		const res = await loadTextE();
		if (res.tabs.length > 0) {
			return res.tabs.map((t) => ({ name: t.name, content: t.content }));
		}
	} catch {
		/* ignore */
	}
	return [
		{ name: "笔记 1", content: "" },
		{ name: "笔记 2", content: "" },
		{ name: "笔记 3", content: "" },
	];
}

async function save(tabs: { name: string; content: string }[]): Promise<void> {
	try {
		await saveTextE(tabs);
	} catch {
		/* ignore */
	}
}

function defaultName(i: number): string {
	return `笔记 ${i + 1}`;
}

export default function TextEditor() {
	const [active, setActive] = createSignal(0);
	const [tabs, setTabs] = createSignal<{ name: string; content: string }[]>([]);
	const [editing, setEditing] = createSignal(-1);
	const [editValue, setEditValue] = createSignal("");

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
		setTabs((prev) => [...prev, { name: defaultName(n), content: "" }]);
		setActive(n);
		markDirty();
	};

	const removeTab = (i: number) => {
		if (tabs().length <= 1) return;
		setTabs((prev) => prev.filter((_, j) => j !== i));
		if (active() >= i && active() > 0) setActive(active() - 1);
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
							tabIndex={0}
							class={active() === i() ? styles.tabActive : styles.tab}
							onClick={() => setActive(i())}
							onDblClick={() => startRename(i())}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") setActive(i());
							}}
						>
							{editing() === i() ? (
								<input
									ref={editInputRef}
									class={styles.renameInput}
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
							>
								×
							</button>
						</div>
					)}
				</For>
				<button type="button" class={styles.addBtn} onClick={addTab}>
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
