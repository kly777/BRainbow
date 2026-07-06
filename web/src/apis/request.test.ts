import { describe, it, expect } from "vitest";
import { extractErrorBody } from "./request";

function mockResponse(body: string, status = 400): Response {
	return new Response(body, {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

// ── JSON 解析 ──

describe("extractErrorBody", () => {
	describe("有效 JSON", () => {
		it("parse code + message", async () => {
			const body = JSON.stringify({
				code: "INVALID_INPUT",
				message: "缺少 'file' 字段",
			});
			const result = await extractErrorBody(mockResponse(body));
			expect(result).toEqual({
				code: "INVALID_INPUT",
				message: "缺少 'file' 字段",
				details: undefined,
			});
		});

		it("parse code + message + details", async () => {
			const body = JSON.stringify({
				code: "INVALID_INPUT",
				message: "参数错误",
				details: { field: "title" },
			});
			const result = await extractErrorBody(mockResponse(body));
			expect(result.code).toBe("INVALID_INPUT");
			expect(result.message).toBe("参数错误");
			expect(result.details).toEqual({ field: "title" });
		});

		it("parse {error} as message", async () => {
			const body = JSON.stringify({
				error: "Something went wrong",
			});
			const result = await extractErrorBody(mockResponse(body));
			expect(result.code).toBe("HTTP_400");
			expect(result.message).toBe("Something went wrong");
		});

		it("ignores JSON without code or message", async () => {
			const body = JSON.stringify({ foo: "bar" });
			const result = await extractErrorBody(mockResponse(body));
			// Falls through to text path
			expect(result.code).toBe("HTTP_400");
			expect(result.message).toBe('{"foo":"bar"}');
		});

		it("ignores JSON with only code (no message)", async () => {
			const body = JSON.stringify({ code: "ERROR" });
			const result = await extractErrorBody(mockResponse(body));
			// Fall through to text path
			expect(result.code).toBe("HTTP_400");
			expect(result.message).toBe('{"code":"ERROR"}');
		});
	});

	// ── 非 JSON 回退 ──

	describe("非 JSON 回退", () => {
		it("plain text as message", async () => {
			const result = await extractErrorBody(
				mockResponse("Not Found", 404),
			);
			expect(result.code).toBe("HTTP_404");
			expect(result.message).toBe("Not Found");
		});

		it("long text truncated to 200", async () => {
			const long = "x".repeat(300);
			const result = await extractErrorBody(
				mockResponse(long),
			);
			expect(result.message.length).toBe(200);
			expect(result.message).toBe("x".repeat(200));
		});

		it("empty body", async () => {
			const result = await extractErrorBody(mockResponse(""));
			expect(result.code).toBe("HTTP_400");
			expect(result.message).toBe("HTTP 400");
		});
	});

	// ── 不同状态码 ──

	describe("状态码", () => {
		it("401 → HTTP_401", async () => {
			const body = JSON.stringify({
				code: "UNAUTHORIZED",
				message: "未认证",
			});
			const result = await extractErrorBody(mockResponse(body, 401));
			expect(result.code).toBe("UNAUTHORIZED");
		});

		it("500 → INTERNAL_ERROR", async () => {
			const body = JSON.stringify({
				code: "INTERNAL_ERROR",
				message: "数据库操作失败",
			});
			const result = await extractErrorBody(mockResponse(body, 500));
			expect(result.code).toBe("INTERNAL_ERROR");
		});
	});

	// ── 边界 ──

	describe("边界", () => {
		it("exactly 200 chars not truncated", async () => {
			const exactly200 = "x".repeat(200);
			const result = await extractErrorBody(
				mockResponse(exactly200),
			);
			expect(result.message.length).toBe(200);
		});

		it("null code treated as code=null (falsy)", async () => {
			const body = JSON.stringify({
				code: null,
				message: "null code",
			});
			const result = await extractErrorBody(mockResponse(body));
			// null is not a string → falls through
			expect(result.code).toBe("HTTP_400");
		});
	});
});
