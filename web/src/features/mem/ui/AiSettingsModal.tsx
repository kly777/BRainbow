// ── AI 设置面板 ──

import { createSignal, Show } from "solid-js";
import Modal from "@components/ui/Modal.tsx";
import { callAi } from "@lib/ai.ts";
import {
	getAiSettings,
	resetAiSettings,
	setAiSettings,
} from "@lib/ai-settings.ts";
import { tryAsync } from "@lib/result.ts";

interface AiSettingsModalProps {
	isOpen: boolean;
	onClose: () => void;
}

export default function AiSettingsModal(props: AiSettingsModalProps) {
	const saved = getAiSettings();
	const [endpoint, setEndpoint] = createSignal(saved.endpoint);
	const [apiKey, setApiKey] = createSignal(saved.apiKey);
	const [model, setModel] = createSignal(saved.model);
	const [mnemonicPrompt, setMnemonicPrompt] = createSignal(
		saved.mnemonicPrompt,
	);
	const [testStatus, setTestStatus] = createSignal<
		"idle" | "testing" | "ok" | "fail"
	>("idle");
	const [testMsg, setTestMsg] = createSignal("");

	const handleSave = () => {
		setAiSettings({
			endpoint: endpoint(),
			apiKey: apiKey(),
			model: model(),
			mnemonicPrompt: mnemonicPrompt(),
		});
		props.onClose();
	};

	const handleReset = () => {
		resetAiSettings();
		const d = getAiSettings();
		setEndpoint(d.endpoint);
		setApiKey(d.apiKey);
		setModel(d.model);
		setMnemonicPrompt(d.mnemonicPrompt);
	};

	const testConnection = async () => {
		setTestStatus("testing");
		setTestMsg("");
		const result = await tryAsync(() =>
			callAi({
				messages: [{ role: "user", content: "回复 'ok' 两个字" }],
				model: model() || undefined,
				maxTokens: 10,
			}),
		);
		if (result.ok) {
			setTestStatus("ok");
			setTestMsg("连接成功 ✅");
		} else {
			setTestStatus("fail");
			setTestMsg(result.error.message);
		}
	};

	return (
		<Modal isOpen={props.isOpen} onClose={props.onClose} title="AI 设置">
			<div
				style={{
					display: "flex",
					"flex-direction": "column",
					gap: "16px",
					"min-width": "480px",
				}}
			>
				{/* API 地址 */}
				<div class="">
					<label class="" for="ai-endpoint">
						API 地址
					</label>
					<input
						id="ai-endpoint"
						type="url"
						value={endpoint()}
						onInput={(e) => setEndpoint(e.currentTarget.value)}
						placeholder="https://api.deepseek.com/v1/chat/completions"
						style={{
							width: "100%",
							padding: "8px 10px",
							"box-sizing": "border-box",
						}}
					/>
				</div>

				{/* API Key */}
				<div class="">
					<label class="" for="ai-key">
						API Key
					</label>
					<input
						id="ai-key"
						type="password"
						value={apiKey()}
						onInput={(e) => setApiKey(e.currentTarget.value)}
						placeholder="sk-..."
						style={{
							width: "100%",
							padding: "8px 10px",
							"box-sizing": "border-box",
						}}
					/>
				</div>

				{/* 模型 */}
				<div class="">
					<label class="" for="ai-model">
						模型
					</label>
					<input
						id="ai-model"
						type="text"
						value={model()}
						onInput={(e) => setModel(e.currentTarget.value)}
						placeholder="deepseek-chat"
						style={{
							width: "100%",
							padding: "8px 10px",
							"box-sizing": "border-box",
						}}
					/>
				</div>

				{/* 测试连接 */}
				<div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
					<button
						type="button"
						onClick={testConnection}
						disabled={testStatus() === "testing"}
						style={{
							padding: "6px 14px",
							cursor: "pointer",
							background: testStatus() === "testing" ? "#ccc" : "#3b82f6",
							color: "#fff",
							border: "none",
							"border-radius": "6px",
						}}
					>
						{testStatus() === "testing" ? "测试中…" : "测试连接"}
					</button>
					<Show when={testStatus() === "ok"}>
						<span style={{ color: "#16a34a" }}>{testMsg()}</span>
					</Show>
					<Show when={testStatus() === "fail"}>
						<span style={{ color: "#dc2626", "font-size": "13px" }}>
							{testMsg()}
						</span>
					</Show>
				</div>

				{/* 分隔线 */}
				<hr
					style={{
						border: "none",
						"border-top": "1px solid #e5e7eb",
						margin: "4px 0",
					}}
				/>

				{/* 助记提示词 */}
				<div class="">
					<label class="" for="ai-prompt">
						助记生成提示词
						<span
							style={{
								"font-weight": "normal",
								color: "#6b7280",
								"margin-left": "8px",
								"font-size": "12px",
							}}
						>
							（可用 {"{cue}"}、{"{target}"} 作为占位符）
						</span>
					</label>
					<textarea
						id="ai-prompt"
						value={mnemonicPrompt()}
						onInput={(e) => setMnemonicPrompt(e.currentTarget.value)}
						rows={6}
						style={{
							width: "100%",
							padding: "8px 10px",
							"box-sizing": "border-box",
							"font-size": "13px",
							"font-family": "monospace",
							resize: "vertical",
						}}
					/>
				</div>

				{/* 操作按钮 */}
				<div
					style={{
						display: "flex",
						"justify-content": "space-between",
						"margin-top": "8px",
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
							"border-radius": "6px",
							color: "#6b7280",
						}}
					>
						恢复默认
					</button>
					<div style={{ display: "flex", gap: "8px" }}>
						<button
							type="button"
							onClick={props.onClose}
							style={{
								padding: "8px 16px",
								cursor: "pointer",
								background: "none",
								border: "1px solid #d1d5db",
								"border-radius": "6px",
							}}
						>
							取消
						</button>
						<button
							type="button"
							onClick={handleSave}
							style={{
								padding: "8px 16px",
								cursor: "pointer",
								background: "#3b82f6",
								color: "#fff",
								border: "none",
								"border-radius": "6px",
							}}
						>
							保存
						</button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
