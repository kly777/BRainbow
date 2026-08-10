// ── 助记提示词配置（挂在 /m 记忆页） ──
// 与全局 AI 服务配置分离：这里只编辑助记生成提示词。

import { createEffect, createSignal } from "solid-js";
import Modal from "@ui/organisms/Modal";
import { getAiSettingsE, updateAiSettingsE } from "@apis/ai.ts";
import { tryOrNotify } from "@lib/safe-action.ts";
import { tryAsync } from "@lib/result.ts";

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
			<div
				style={{
					display: "flex",
					"flex-direction": "column",
					gap: "0.75rem",
					"min-width": "30rem",
				}}
			>
				<label class="" for="mnemonic-prompt">
					助记生成提示词
					<span
						style={{
							"font-weight": "normal",
							color: "#6b7280",
							"margin-left": "0.5rem",
							"font-size": "0.75rem",
						}}
					>
						（可用 {"{cue}"}、{"{target}"} 作为占位符）
					</span>
				</label>
				<textarea
					id="mnemonic-prompt"
					value={prompt()}
					onInput={(e) => setPrompt(e.currentTarget.value)}
					rows={6}
					style={{
						width: "100%",
						padding: "8px 10px",
						"box-sizing": "border-box",
						"font-size": "0.8125rem",
						"font-family": "monospace",
						resize: "vertical",
					}}
				/>
				<div
					style={{
						display: "flex",
						"justify-content": "space-between",
						"margin-top": "0.5rem",
					}}
				>
					<button
						type="button"
						onClick={handleReset}
						style={{
							padding: "8px 16px",
							cursor: "pointer",
							background: "none",
							border: "1px solid #d1d5db",
							"border-radius": "0.375rem",
							color: "#6b7280",
						}}
					>
						恢复默认
					</button>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<button
							type="button"
							onClick={props.onClose}
							style={{
								padding: "8px 16px",
								cursor: "pointer",
								background: "none",
								border: "1px solid #d1d5db",
								"border-radius": "0.375rem",
							}}
						>
							取消
						</button>
						<button
							type="button"
							onClick={() => void handleSave()}
							disabled={loading()}
							style={{
								padding: "8px 16px",
								cursor: "pointer",
								background: loading() ? "#ccc" : "#3b82f6",
								color: "#fff",
								border: "none",
								"border-radius": "0.375rem",
							}}
						>
							{loading() ? "保存中…" : "保存"}
						</button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
