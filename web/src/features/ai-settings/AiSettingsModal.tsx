// ── AI 服务设置面板（配置存数据库，后端代理） ──
// 仅管 AI 服务本身（API 地址 / Key / 模型）；助记提示词在 /m 页单独配置。

import {
	getAiSettingsE,
	updateAiSettingsE,
} from "@entities/ai-settings/api.ts";
import { callAi } from "@features/ai-settings/ai.ts";
import { tryAsync } from "@shared/lib/result.ts";
import Modal from "@shared/ui/organisms/Modal";
import { createEffect, createSignal, Show } from "solid-js";
import { aiSettingsOpen, closeAiSettings } from "./aiSettingsStore.ts";

export default function AiSettingsModal() {
	const [endpoint, setEndpoint] = createSignal("");
	const [apiKey, setApiKey] = createSignal("");
	const [model, setModel] = createSignal("");
	const [hasKey, setHasKey] = createSignal(false);
	const [loading, setLoading] = createSignal(false);
	const [testStatus, setTestStatus] = createSignal<
		"idle" | "testing" | "ok" | "fail"
	>("idle");
	const [testMsg, setTestMsg] = createSignal("");

	// 每次打开时从后端加载当前配置
	createEffect(() => {
		if (!aiSettingsOpen()) return;
		void (async () => {
			setTestStatus("idle");
			setTestMsg("");
			const r = await tryAsync(() => getAiSettingsE());
			if (r.ok) {
				setEndpoint(r.value.endpoint);
				setModel(r.value.model);
				setHasKey(r.value.has_key);
			}
		})();
	});

	const handleSave = async () => {
		setLoading(true);
		const r = await tryAsync(() =>
			updateAiSettingsE({
				endpoint: endpoint(),
				api_key: apiKey(), // 留空 = 保持原 key
				model: model(),
			}),
		);
		setLoading(false);
		if (r.ok) {
			setHasKey(r.value.has_key);
			setApiKey("");
			closeAiSettings();
		}
	};

	const handleReset = () => {
		setEndpoint("");
		setModel("");
		setApiKey("");
		setHasKey(false);
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
		<Modal isOpen={aiSettingsOpen()} onClose={closeAiSettings} title="AI 设置">
			<div
				style={{
					display: "flex",
					"flex-direction": "column",
					gap: "1rem",
					"min-width": "30rem",
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
						placeholder={hasKey() ? "已配置（留空保持不变）" : "sk-..."}
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
				<div
					style={{ display: "flex", "align-items": "center", gap: "0.5rem" }}
				>
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
							"border-radius": "0.375rem",
						}}
					>
						{testStatus() === "testing" ? "测试中…" : "测试连接"}
					</button>
					<Show when={testStatus() === "ok"}>
						<span style={{ color: "#16a34a" }}>{testMsg()}</span>
					</Show>
					<Show when={testStatus() === "fail"}>
						<span style={{ color: "#dc2626", "font-size": "0.8125rem" }}>
							{testMsg()}
						</span>
					</Show>
				</div>

				{/* 操作按钮 */}
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
							onClick={closeAiSettings}
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
