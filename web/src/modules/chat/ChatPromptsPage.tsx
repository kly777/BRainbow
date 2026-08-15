// ── 提示词预设管理：增删改查 ──

import { Button } from "@components/ui";
import { showConfirm, tryAsync, tryOrNotify } from "@lib/utils";
import type { PromptPreset } from "@modules/chat";
import {
	createPresetE,
	deletePresetE,
	listPresetsE,
	updatePresetE,
} from "@modules/chat";
import { createSignal, For, onMount, Show } from "solid-js";
import styles from "./ChatPrompts.module.css";

export default function ChatPromptsPage() {
	const [presets, setPresets] = createSignal<PromptPreset[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [editing, setEditing] = createSignal<PromptPreset | null>(null);
	const [name, setName] = createSignal("");
	const [content, setContent] = createSignal("");
	const [creating, setCreating] = createSignal(false);

	onMount(async () => {
		const r = await tryAsync(() => listPresetsE());
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
		const r = await tryAsync(() => listPresetsE());
		if (r.ok) setPresets(r.value);
	};

	const remove = async (preset: PromptPreset) => {
		const confirmed = await showConfirm({
			title: "删除预设",
			message: `确定删除预设「${preset.name}」吗？此操作不可撤销。`,
			variant: "danger",
		});
		if (!confirmed) return;
		const ok = await tryOrNotify(() => deletePresetE(preset.id), "删除预设");
		if (ok === null) return;
		setPresets((prev) => prev.filter((p) => p.id !== preset.id));
	};

	return (
		<div class={styles.page}>
			<div class={styles.head}>
				<h1 class={styles.title}>提示词预设</h1>
				<Button
					variant="primary"
					size="sm"
					onClick={() => {
						setEditing(null);
						setName("");
						setContent("");
						setCreating(true);
					}}
				>
					＋ 新建预设
				</Button>
			</div>

			<Show when={creating() || editing()}>
				<div class={styles.editor}>
					<input
						type="text"
						class={styles.input}
						placeholder="预设名称（如：代码导师）"
						aria-label="预设名称"
						value={name()}
						onInput={(e) => setName(e.currentTarget.value)}
					/>
					<textarea
						class={styles.textarea}
						rows={4}
						placeholder="系统提示词内容…"
						aria-label="预设内容"
						value={content()}
						onInput={(e) => setContent(e.currentTarget.value)}
					/>
					<div class={styles.actions}>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								setCreating(false);
								setEditing(null);
							}}
						>
							取消
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={!name().trim() || !content().trim()}
							onClick={() => void save()}
						>
							保存
						</Button>
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
										<Button
											variant="secondary"
											size="sm"
											onClick={() => {
												setEditing(preset);
												setName(preset.name);
												setContent(preset.content);
											}}
										>
											编辑
										</Button>
										<Button
											variant="danger"
											size="sm"
											onClick={() => void remove(preset)}
										>
											删除
										</Button>
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
