// ── AI 设置管理（localStorage 持久化） ──

const KEYS = {
	endpoint: "ai_endpoint",
	apiKey: "ai_api_key",
	mnemonicPrompt: "ai_mnemonic_prompt",
	model: "ai_model",
} as const;

export interface AiSettings {
	endpoint: string;
	apiKey: string;
	model: string;
	mnemonicPrompt: string;
}

const DEFAULTS: AiSettings = {
	endpoint: "https://api.deepseek.com/v1/chat/completions",
	apiKey: "",
	model: "deepseek-v4-flash",
	mnemonicPrompt:
		"你是一个记忆专家。用户在学习一张卡片时连续答错 3 次，请为其生成一个助记技巧（mnemonic）帮助记忆。\n\n卡片内容：\n线索：{cue}\n答案：{target}\n\n请给出一个简短、有创意、易记的助记方法（中英文均可，30 字以内）。直接输出助记内容，不要前缀。",
};

export function getAiSettings(): AiSettings {
	return {
		endpoint: localStorage.getItem(KEYS.endpoint) ?? DEFAULTS.endpoint,
		apiKey: localStorage.getItem(KEYS.apiKey) ?? DEFAULTS.apiKey,
		model: localStorage.getItem(KEYS.model) ?? DEFAULTS.model,
		mnemonicPrompt:
			localStorage.getItem(KEYS.mnemonicPrompt) ?? DEFAULTS.mnemonicPrompt,
	};
}

export function setAiSettings(s: Partial<AiSettings>): void {
	if (s.endpoint !== undefined) localStorage.setItem(KEYS.endpoint, s.endpoint);
	if (s.apiKey !== undefined) localStorage.setItem(KEYS.apiKey, s.apiKey);
	if (s.model !== undefined) localStorage.setItem(KEYS.model, s.model);
	if (s.mnemonicPrompt !== undefined)
		localStorage.setItem(KEYS.mnemonicPrompt, s.mnemonicPrompt);
}

export function resetAiSettings(): void {
	localStorage.removeItem(KEYS.endpoint);
	localStorage.removeItem(KEYS.apiKey);
	localStorage.removeItem(KEYS.model);
	localStorage.removeItem(KEYS.mnemonicPrompt);
}

/** 替换提示词模板中的占位符 */
export function fillPrompt(
	template: string,
	vars: Record<string, string>,
): string {
	let result = template;
	for (const [key, val] of Object.entries(vars)) {
		result = result.replace(new RegExp(`\\{${key}\\}`, "g"), val);
	}
	return result;
}
