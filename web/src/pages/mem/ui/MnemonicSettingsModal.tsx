// ── 助记提示词配置（挂在 /m 记忆页） ──
// 与全局 AI 服务配置分离：这里只编辑助记生成提示词。

import { getAiSettingsE, updateAiSettingsE } from "@entities/ai-settings";
import styles from "@pages/mem/ui/MnemonicSettingsModal.module.css";
import { tryAsync } from "@shared/lib/result.ts";
import { tryOrNotify } from "@shared/lib/safe-action.ts";
import Modal from "@shared/ui/organisms/Modal";
import { createEffect, createSignal } from "solid-js";

const DEFAULT_MNEMONIC_PROMPT =
	"你是一个记忆专家。用户在学习一张卡片时连续答错 3 次，请为其生成一个助记技巧（mnemonic）帮助记忆。\n\n卡片内容：\n线索：{cue}\n答案：{target}\n\n请给出一个简短、有创意、易记的助记方法（中英文均可，30 字以内）。直接输出助记内容，不要前缀。";

interface Props {
	isOpen: boolean;
	onClose: () => void;
}

export default function MnemonicSettingsModal(props: Props) {
	const [prompt, setPrompt] = createSignal("");
	const [loading, setLoading] = createSignal(false);

	// 打开时加载当前助记提示词
	createEffect(() => {
		if (!props.isOpen) return;
		void (async () => {
			const r = await tryAsync(() => getAiSettingsE());
			if (r.ok) setPrompt(r.value.mnemonic_prompt);
		})();
	});

	const handleSave = async () => {
		setLoading(true);
		const ok = await tryOrNotify(
			() => updateAiSettingsE({ mnemonic_prompt: prompt() }),
			"保存助记提示词",
		);
		setLoading(false);
		if (ok !== null) props.onClose();
	};

	const handleReset = () => setPrompt(DEFAULT_MNEMONIC_PROMPT);

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title="助记提示词设置">
			<div class={styles.body}>
				<label class="" for="mnemonic-prompt">
					助记生成提示词
					<span class={styles.labelHint}>
						（可用 {"{cue}"}、{"{target}"} 作为占位符）
					</span>
				</label>
				<textarea
					id="mnemonic-prompt"
					class={styles.prompt}
					value={prompt()}
					onInput={(e) => setPrompt(e.currentTarget.value)}
					rows={6}
				/>
				<div class={styles.actions}>
					<button type="button" class={styles.btnGhost} onClick={handleReset}>
						恢复默认
					</button>
					<div class={styles.actionsRight}>
						<button
							type="button"
							class={styles.btnGhost}
							onClick={props.onClose}
						>
							取消
						</button>
						<button
							type="button"
							class={styles.btnPrimary}
							disabled={loading()}
							onClick={() => void handleSave()}
						>
							{loading() ? "保存中…" : "保存"}
						</button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
