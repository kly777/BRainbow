import { describe, expect, it } from "vitest";
import {
	buildGeneratePrompt,
	buildRevisePrompt,
	countKnowledgePoints,
	parseAiCards,
} from "./ai-cards.ts";

describe("parseAiCards", () => {
	it("解析裸 JSON 数组", () => {
		const r = parseAiCards('[{"cue":"质能方程","target":"E=mc²"}]');
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value).toEqual([{ cue: "质能方程", target: "E=mc²" }]);
		}
	});

	it("解析 ```json 代码块", () => {
		const r = parseAiCards(
			'```json\n[{"cue":"a","target":"b"}]\n```\n（这是解释文字）',
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([{ cue: "a", target: "b" }]);
	});

	it("解析 {cards: [...]} 包装", () => {
		const r = parseAiCards(
			'{"cards":[{"cue":"q","target":"t"},{"cue":"q2","target":"t2"}]}',
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.length).toBe(2);
	});

	it("过滤空 cue/target 并去空白", () => {
		const r = parseAiCards(
			'[{"cue":"  空格  ","target":"x"},{"cue":"","target":"空线索"},{"cue":"空答案","target":"  "}]',
		);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([{ cue: "空格", target: "x" }]);
	});

	it("容忍前置解释文字", () => {
		const r = parseAiCards('好的，以下是卡片：\n[{"cue":"a","target":"b"}]');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([{ cue: "a", target: "b" }]);
	});

	it("非 JSON 返回 err", () => {
		const r = parseAiCards("抱歉，我无法生成卡片");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("JSON");
	});

	it("空结果返回 err", () => {
		const r = parseAiCards("[]");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.error).toContain("JSON");
	});

	it("修复键名缺冒号（target 后无冒号）", () => {
		const r = parseAiCards('[{"cue":"质能方程","target "E=mc²"}]');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual([{ cue: "质能方程", target: "E=mc²" }]);
	});

	it("整体损坏时逐对象恢复可用卡片", () => {
		const raw =
			'[{"cue":"问题A","target "答案A"},{"cue":"问题B","target":"答案B"}]';
		const r = parseAiCards(raw);
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.value.length).toBe(2);
			expect(r.value[0]).toEqual({ cue: "问题A", target: "答案A" });
			expect(r.value[1]).toEqual({ cue: "问题B", target: "答案B" });
		}
	});

	it("对象粘连缺逗号时恢复", () => {
		const raw = '[{"cue":"q1","target":"t1"}{"cue":"q2","target":"t2"}]';
		const r = parseAiCards(raw);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.length).toBe(2);
	});

	it("真实损坏样例：目标字符串未闭合+键缺冒号 → 恢复多数卡片", () => {
		const raw = `[
{"cue": "问题A", "target "答案A"},
{"cue": "问题B", "target": "答案B部分" {"cue": "问题C", "target "答案C"},
{"cue": "问题D", "target": "答案D"},
{"cue": "问题E", "target "答案E"}
]`;
		const r = parseAiCards(raw);
		expect(r.ok).toBe(true);
		if (r.ok) {
			const cues = r.value.map((c) => c.cue);
			expect(cues).toContain("问题A");
			expect(cues).toContain("问题C");
			expect(cues).toContain("问题D");
			expect(cues).toContain("问题E");
		}
	});
});

describe("prompt 构建", () => {
	it("生成 prompt 包含原文与 JSON 要求", () => {
		const p = buildGeneratePrompt("光速是常数");
		expect(p).toContain("光速是常数");
		expect(p).toContain('[{"cue"');
	});

	it("修订 prompt 包含现有卡片与指令", () => {
		const p = buildRevisePrompt(
			"原文",
			[
				{ cue: "q1", target: "t1" },
				{ cue: "q2", target: "t2" },
			],
			"简化第二条",
		);
		expect(p).toContain("原文");
		expect(p).toContain("q1");
		expect(p).toContain("简化第二条");
		expect(p).toContain("t2");
	});
});

describe("countKnowledgePoints", () => {
	it("顿号分隔的知识点列表", () => {
		expect(
			countKnowledgePoints(
				"0-1分布、二项分布、泊松分布、超几何分布、几何分布、均匀分布、指数分布、正态分布、标准正态分布、伽马分布、t分布、F分布",
			),
		).toBe(12);
	});

	it("逗号分隔", () => {
		expect(countKnowledgePoints("a分布, b分布, c分布")).toBe(3);
	});

	it("单个知识点", () => {
		expect(countKnowledgePoints("质能方程")).toBe(1);
	});

	it("空文本", () => {
		expect(countKnowledgePoints("   ")).toBe(0);
	});
});
