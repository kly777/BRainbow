import { describe, expect, it } from "vitest";
import { fillPath, PATHS } from "./paths.ts";

describe("PATHS", () => {
	it("根路径为 /", () => {
		expect(PATHS.home).toBe("/");
	});

	it("父子路径由常量拼接", () => {
		expect(PATHS.card).toBe("/card");
		expect(PATHS.cardDetail).toBe("/card/:id");
		expect(PATHS.cardEdit).toBe("/card/edit/:id");
		expect(PATHS.cardAdd).toBe("/card/add");

		expect(PATHS.reading).toBe("/reading");
		expect(PATHS.readingDetail).toBe("/reading/:id");
		expect(PATHS.readingUnknown).toBe("/reading/unknown");

		expect(PATHS.memory).toBe("/memory");
		expect(PATHS.memoryAdd).toBe("/memory/add");
		expect(PATHS.memoryManage).toBe("/memory/manage");

		expect(PATHS.chat).toBe("/chat");
		expect(PATHS.chatPrompts).toBe("/chat/prompts");
		expect(PATHS.chatMem).toBe("/chat/mem");

		expect(PATHS.conversation).toBe("/conversation");
		expect(PATHS.convDetail).toBe("/conversation/detail/:id");
		expect(PATHS.convConcept).toBe("/conversation/concept/:id");
	});

	it("独立路径无前缀", () => {
		expect(PATHS.task).toBe("/task");
		expect(PATHS.ontology).toBe("/ontology");
		expect(PATHS.search).toBe("/search");
		expect(PATHS.admin).toBe("/admin");
		expect(PATHS.key).toBe("/key");
	});
});

describe("fillPath", () => {
	it("替换 :id 为数字", () => {
		expect(fillPath("/task/:id", 42)).toBe("/task/42");
		expect(fillPath("/card/:id", 1)).toBe("/card/1");
	});

	it("替换 :id 为字符串", () => {
		expect(fillPath("/reading/:id", "abc")).toBe("/reading/abc");
	});

	it("无 :id 时原样返回", () => {
		expect(fillPath("/task", 42)).toBe("/task");
	});
});
