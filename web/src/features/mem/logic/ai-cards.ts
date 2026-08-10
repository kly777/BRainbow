// ── AI 生成记忆卡片：纯函数层 ──
// prompt 构建 + AI 输出容错解析（零副作用，可单测）

import { err, ok, trySync, type Result } from "@lib/result.ts";

export interface AiCard {
	cue: string;
	target: string;
}

const JSON_ONLY =
	"只输出 JSON 数组（不要任何解释、不要代码块标记），格式：" +
	'[{"cue": "问题或线索", "target": "答案"}]';

/** 生成 prompt：从一段文本生成 1~5 张记忆卡片 */
export function buildGeneratePrompt(text: string): string {
	return `你是一名记忆卡片生成专家。根据下面提供的文本，生成 1 到 5 张高质量的记忆卡片。

卡片要求：
- cue：线索/问题，能触发主动回忆（可用省略填空，如 "质能方程：____"）
- target：简洁准确的答案，突出关键信息
- 覆盖文本中的核心知识点，不要生成琐碎或重复的卡片
${JSON_ONLY}

文本：
"""
${text}
"""`;
}

/** 渐进修改 prompt：按用户指令修订现有卡片（可增删改） */
export function buildRevisePrompt(
	originalText: string,
	cards: readonly AiCard[],
	instruction: string,
): string {
	const cardList = cards
		.map((c, i) => `${i + 1}. cue: ${c.cue} | target: ${c.target}`)
		.join("\n");
	return `你是一名记忆卡片生成专家。以下是基于某段文本生成的记忆卡片，请根据用户的修改指令修订它们。

原文：
"""
${originalText}
"""

现有卡片：
${cardList}

用户指令：${instruction}

要求：输出修订后的完整卡片 JSON 数组（可修改、删除、新增卡片）。
${JSON_ONLY}`;
}

/** 容错解析 AI 输出：支持 ```json 代码块、裸 JSON 数组、{cards: [...]} */
export function parseAiCards(raw: string): Result<AiCard[], string> {
	const cleaned = extractJson(raw);
	const parsed = trySync(() => JSON.parse(cleaned));
	if (!parsed.ok) return err("AI 返回的不是有效 JSON，请重试");

	const items = Array.isArray(parsed.value)
		? parsed.value
		: (parsed.value as { cards?: unknown } | null)?.cards;
	if (!Array.isArray(items)) return err("AI 返回格式缺少卡片数组，请重试");

	const cards = items
		.map((i) => ({
			cue: String((i as { cue?: unknown })?.cue ?? "").trim(),
			target: String((i as { target?: unknown })?.target ?? "").trim(),
		}))
		.filter((c) => c.cue && c.target);

	if (cards.length === 0) return err("AI 未生成有效卡片，请重试");
	return ok(cards);
}

function extractJson(raw: string): string {
	const trimmed = raw.trim();
	if (!trimmed) return trimmed;

	// ```json ... ``` 代码块
	const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
	if (fence) return fence[1].trim();

	// 裸 JSON 数组：取第一个 [ 到最后一个 ]
	const start = trimmed.indexOf("[");
	const end = trimmed.lastIndexOf("]");
	if (start !== -1 && end > start) return trimmed.slice(start, end + 1);

	return trimmed;
}
