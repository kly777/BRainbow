// ── AI 提示词模板辅助 ──
// AI 设置已迁移至后端数据库（@apis/ai.ts），本文件仅保留纯工具函数。

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
