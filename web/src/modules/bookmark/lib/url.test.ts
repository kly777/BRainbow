import { describe, expect, it } from "vitest";
import { extractDomain } from "./url.ts";

describe("extractDomain", () => {
	it("取主机名", () => {
		expect(extractDomain("https://example.com/a/b?c=1")).toBe("example.com");
	});

	it("去掉 www.", () => {
		expect(extractDomain("https://www.example.com")).toBe("example.com");
		expect(extractDomain("http://www.example.com/x")).toBe("example.com");
	});

	it("保留子域与端口语义（只砍 www.）", () => {
		expect(extractDomain("https://blog.example.com")).toBe("blog.example.com");
		expect(extractDomain("http://localhost:3000/x")).toBe("localhost");
	});

	it("不是合法 URL 时原样返回（不留空白）", () => {
		expect(extractDomain("随手记的一条")).toBe("随手记的一条");
		expect(extractDomain("")).toBe("");
	});
});
