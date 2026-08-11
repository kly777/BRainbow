// ── 提示词预设管理：增删改查 ──

import {
	createPresetE,
	deletePresetE,
	type PromptPreset,
	updatePresetE,
} from "@features/chat/api.ts";
import styles from "@features/chat/ChatPrompts.module.css";
import { tryOrNotify } from "@shared/lib/safe-action.ts";
import { createSignal, For, onMount, Show } from "solid-js";

export default function ChatPromptsPage() {
	const [presets, setPresets] = createSignal<PromptPreset[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [editing, setEditing] = createSignal<PromptPreset | null>(null);
	const [name, setName] = createSignal("");
	const [content, setContent] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	onMount(async () => {
		const r = await import("@shared/lib/result.ts").then((m) =>
			m.tryAsync(() =>
				import("@features/chat/api.ts").then((a) => a.listPresetsE()),
			),
		);
		if (r.ok) setPresets(r.value);
		setLoading(false);
	});

	const save = async () => {
		const ed = editing();
		const ok = await tryOrNotify<unknown>(
			() =>
				ed
					? updatePresetE(ed.id, name().trim(), content().trim())
					: createPresetE(name().trim(), content().trim()),
			ed ? "更新预设" : "创建预设",
		);
		if (ok === null) return;
		setEditing(null);
		setName("");
		setContent("");
		const r = await import("@shared/lib/result.ts").then((m) =>
			m.tryAsync(() =>
				import("@features/chat/api.ts").then((a) => a.listPresetsE()),
			),
		);
		if (r.ok) setPresets(r.value);
	};

	const remove = async (preset: PromptPreset) => {
		const ok = await tryOrNotify(() => deletePresetE(preset.id), "删除预设");
		if (ok === null) return;
		setPresets((prev) => prev.filter((p) => p.id !== preset.id));
	};

	return (
		<div class={styles.page}>
			<div class={styles.head}>
				<h1 class={styles.title}>提示词预设</h1>
				<button
					type="button"
					class={styles.btnPrimary}
					onClick={() => {
						setEditing(null);
						setName("");
						setContent("");
						setCreating(true);
					}}
				>
					＋ 新建预设
				</button>
			</div>

			<Show when={creating() || editing()}>
				<div class={styles.editor}>
					<input
						type="text"
						class={styles.input}
						placeholder="预设名称（如：代码导师）"
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
					/>
					<textarea
						class={styles.textarea}
						rows={4}
						placeholder="系统提示词内容…"
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
					/>
					<div class={styles.actions}>
						<button
							type="button"
							class={styles.btnGhost}
							onClick={() => {
								setCreating(false);
								setEditing(null);
							}}
						>
							取消
						</button>
						<button
							type="button"
							class={styles.btnPrimary}
							disabled={!name().trim() || !content().trim()}
							onClick={() => void save()}
						>
							保存
						</button>
					</div>
				</div>
			</Show>

			<div class={styles.list}>
				<Show
					when={!loading}
					fallback={<div class={styles.empty}>加载中…</div>}
				>
					<Show
						when={presets().length > 0}
						fallback={
							<div class={styles.empty}>还没有预设，点击右上角创建</div>
						}
					>
						<For each={presets()}>
							{(preset) => (
								<div class={styles.item}>
									<div class={styles.itemMain}>
										<span class={styles.itemName}>{preset.name}</span>
										<span class={styles.itemContent}>{preset.content}</span>
									</div>
									<div class={styles.itemActions}>
										<button
											type="button"
											class={styles.itemBtn}
											onClick={() => {
												setEditing(preset);
												setName(preset.name);
												setContent(preset.content);
											}}
										>
											编辑
										</button>
										<button
											type="button"
											class={styles.itemBtnDanger}
											onClick={() => void remove(preset)}
										>
											删除
										</button>
									</div>
								</div>
							)}
						</For>
					</Show>
				</Show>
			</div>
		</div>
	);
}
