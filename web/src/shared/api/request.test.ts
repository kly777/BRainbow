import { describe, expect, it } from "vitest";
import { describeGatewayStatus, extractErrorBody } from "./request";

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
			const result = await extractErrorBody(mockResponse("Not Found", 404));
			expect(result.code).toBe("HTTP_404");
			expect(result.message).toBe("Not Found");
		});

		it("long text truncated to 200", async () => {
			const long = "x".repeat(300);
			const result = await extractErrorBody(mockResponse(long));
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

	// ── 网关状态码（中间层编的 502/503/504，不是后端回的） ──

	describe("网关状态码", () => {
		it("空响应体的 502 给能对上现象的说明，而不是一句 HTTP 502", async () => {
			// vite 开发代理在后端没响应时正是这样：只写状态码、不写正文。
			// 真实场景：后端 panic 把连接丢了，用户只看到 "上传失败（HTTP 502）"
			const result = await extractErrorBody(mockResponse("", 502));
			expect(result.code).toBe("HTTP_502");
			expect(result.message).toContain("后端没有响应");
		});

		it("HTML 错误页走同一套说明", async () => {
			const result = await extractErrorBody(
				mockResponse("<html>503</html>", 503),
			);
			expect(result.message).toContain("暂时不可用");
		});

		it("后端自己回的 JSON 错误体优先于网关文案", async () => {
			const body = JSON.stringify({
				code: "INTERNAL",
				message: "服务器内部错误：切点不在字符边界上",
			});
			const result = await extractErrorBody(mockResponse(body, 502));
			expect(result.code).toBe("INTERNAL");
			expect(result.message).toContain("切点不在字符边界上");
		});

		it("非网关状态码不受影响", async () => {
			const result = await extractErrorBody(mockResponse("", 400));
			expect(result.message).toBe("HTTP 400");
		});
	});

	describe("边界", () => {
		it("exactly 200 chars not truncated", async () => {
			const exactly200 = "x".repeat(200);
			const result = await extractErrorBody(mockResponse(exactly200));
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

describe("describeGatewayStatus", () => {
	it("只认 502/503/504", () => {
		expect(describeGatewayStatus(502)).toContain("后端没有响应");
		expect(describeGatewayStatus(503)).toContain("暂时不可用");
		expect(describeGatewayStatus(504)).toContain("超时");
		// 其余状态码由后端/调用方给文案，这里不插手
		expect(describeGatewayStatus(500)).toBe(null);
		expect(describeGatewayStatus(404)).toBe(null);
		expect(describeGatewayStatus(200)).toBe(null);
	});
});
