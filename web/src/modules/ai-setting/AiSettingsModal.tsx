// ── AI 服务设置面板（配置存数据库，后端代理） ──
// 仅管 AI 服务本身（API 地址 / Key / 模型）；助记提示词在 /m 页单独配置。

import { Button, Input, Modal } from "@components/ui";
import { getAiSettingsE, updateAiSettingsE } from "@modules/ai-setting";
import { getErrorMessage } from "@shared/api";
import { notifyError, notifySuccess, tryAsync } from "@shared/utils";
import { createEffect, createSignal, Show } from "solid-js";
import styles from "./AiSettingsModal.module.css";
import { callAi } from "./ai.ts";
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
			} else {
				notifyError("加载 AI 设置失败", r.error);
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
			notifySuccess("AI 设置已保存");
			closeAiSettings();
		} else {
			notifyError("保存 AI 设置失败", r.error);
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
			setTestMsg("连接成功");
		} else {
			setTestStatus("fail");
			setTestMsg(getErrorMessage(result.error));
		}
	};

	return (
		<Modal
			isOpen={aiSettingsOpen()}
			onClose={closeAiSettings}
			title="AI 设置"
			actions={
				<>
					<Button
						variant="secondary"
						onClick={handleReset}
						class={styles.footerLeft}
					>
						恢复默认
					</Button>
					<Button variant="secondary" onClick={closeAiSettings}>
						取消
					</Button>
					<Button
						variant="primary"
						onClick={() => void handleSave()}
						disabled={loading()}
					>
						{loading() ? "保存中…" : "保存"}
					</Button>
				</>
			}
		>
			<div class={styles.body}>
				<div class={styles.field}>
					<label class={styles.label} for="ai-endpoint">
						API 地址
					</label>
					<Input
						id="ai-endpoint"
						type="url"
						class={styles.input}
						value={endpoint()}
						onInput={(e) => setEndpoint(e.currentTarget.value)}
						placeholder="https://api.deepseek.com/v1/chat/completions"
						tone="bg"
					/>
				</div>

				<div class={styles.field}>
					<label class={styles.label} for="ai-key">
						API Key
					</label>
					<Input
						id="ai-key"
						type="password"
						class={styles.input}
						value={apiKey()}
						onInput={(e) => setApiKey(e.currentTarget.value)}
						placeholder={hasKey() ? "已配置（留空保持不变）" : "sk-..."}
						tone="bg"
					/>
				</div>

				<div class={styles.field}>
					<label class={styles.label} for="ai-model">
						模型
					</label>
					<Input
						id="ai-model"
						type="text"
						class={styles.input}
						value={model()}
						onInput={(e) => setModel(e.currentTarget.value)}
						placeholder="deepseek-chat"
						tone="bg"
					/>
				</div>

				<div class={styles.testRow}>
					<Button
						variant="secondary"
						size="sm"
						onClick={testConnection}
						disabled={testStatus() === "testing"}
					>
						{testStatus() === "testing" ? "测试中…" : "测试连接"}
					</Button>
					<Show when={testStatus() === "ok"}>
						<span class={styles.statusOk}>{testMsg()}</span>
					</Show>
					<Show when={testStatus() === "fail"}>
						<span class={styles.statusFail}>{testMsg()}</span>
					</Show>
				</div>
			</div>
		</Modal>
	);
}
