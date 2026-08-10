// ── 新建对话：标题 + 选择/自定义系统提示词 ──

import { For, Show, createSignal, onMount } from "solid-js";
import { useChatPage } from "@features/chat/logic/useChatPage.ts";
import type { PromptPreset } from "@features/chat/api.ts";
import styles from "@features/chat/ChatNew.module.css";

export default function ChatNewPage() {
	const c = useChatPage();
	const [title, setTitle] = createSignal("");
	const [prompt, setPrompt] = createSignal("");
	const [selectedPreset, setSelectedPreset] = createSignal<number | null>(null);
	const [saving, setSaving] = createSignal(false);

	onMount(() => {
		void c.loadPresets();
	});

	const usePreset = (preset: PromptPreset) => {
		setSelectedPreset(preset.id);
		setPrompt(preset.content);
	};

	const create = async () => {
		if (saving() || !title().trim()) return;
		setSaving(true);
		await c.createTree(title().trim(), prompt().trim());
		setSaving(false);
	};

	return (
		<div class={styles.page}>
			<div class={styles.card}>
				<h1 class={styles.title}>新建对话</h1>

				<label class={styles.label} for="chat-new-title">
					标题
				</label>
				<input
					id="chat-new-title"
					type="text"
					class={styles.input}
					placeholder="例如：学 Rust 生命周期"
					value={title()}
					onInput={(e) => setTitle(e.currentTarget.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void create();
					}}
				/>

				<label class={styles.label} for="chat-new-prompt">
					系统提示词（可选，决定 AI 的角色与风格）
				</label>
				<textarea
					id="chat-new-prompt"
					class={styles.textarea}
					rows={4}
					placeholder="例如：你是一个严谨的代码导师，用中文回答，先给结论再解释…"
					value={prompt()}
					onInput={(e) => {
						setPrompt(e.currentTarget.value);
						setSelectedPreset(null);
					}}
				/>

				<Show when={c.presets().length > 0}>
					<span class={styles.label}>或从预设选择</span>
					<div class={styles.presets}>
						<For each={c.presets()}>
							{(preset) => (
								<button
									type="button"
									class={
										selectedPreset() === preset.id
											? styles.presetActive
											: styles.preset
									}
									onClick={() => usePreset(preset)}
								>
									{preset.name}
								</button>
							)}
						</For>
					</div>
				</Show>

				<div class={styles.actions}>
					<button
						type="button"
						class={styles.btnGhost}
						onClick={() => c.navigate("/chat")}
					>
						取消
					</button>
					<button
						type="button"
						class={styles.btnPrimary}
						disabled={saving() || !title().trim()}
						onClick={() => void create()}
					>
						{saving() ? "创建中…" : "创建对话"}
					</button>
				</div>
			</div>
		</div>
	);
}
