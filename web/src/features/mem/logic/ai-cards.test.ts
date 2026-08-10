import { describe, expect, it } from "vitest";
import {
	buildGeneratePrompt,
	buildRevisePrompt,
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
		if (!r.ok) expect(r.error).toContain("未生成");
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
