import { describe, expect, it } from "vitest";
import {
	getErrorMessage,
	HttpError,
	NetworkError,
	ValidationError,
} from "./errors.ts";

// 这里原本还测 showErrorAlert / showErrorInline —— 两个函数零调用点（只有这个测试在用），
// 抑制规则已并进 notifyError（见 shared/utils/notify.ts 的 alreadyReported 与它的测试）。

describe("getErrorMessage", () => {
	it("extracts message from HttpError with details", () => {
		const err = new HttpError({
			status: 404,
			code: "NOT_FOUND",
			message: "卡片不存在",
			details: { id: 42 },
		});
		const msg = getErrorMessage(err);
		expect(msg).toContain("卡片不存在");
		expect(msg).toContain("42");
	});

	it("extracts message from HttpError without details", () => {
		const err = new HttpError({
			status: 500,
			code: "INTERNAL_ERROR",
			message: "服务器崩了",
		});
		const msg = getErrorMessage(err);
		expect(msg).toContain("服务器崩了");
	});

	it("falls back for HttpError without message", () => {
		const err = new HttpError({
			status: 403,
			code: "FORBIDDEN",
			message: "",
		});
		const msg = getErrorMessage(err);
		expect(msg).toContain("403");
		expect(msg).toContain("FORBIDDEN");
	});

	it('returns "网络连接失败" for NetworkError', () => {
		const err = new NetworkError({ cause: "fetch failed" });
		expect(getErrorMessage(err)).toBe("网络连接失败，请检查网络");
	});

	it('returns "数据格式错误" for ValidationError', () => {
		const err = new ValidationError({ error: { field: "name" } });
		expect(getErrorMessage(err)).toBe("数据格式错误，请联系开发者");
	});

	it("extracts message from generic Error", () => {
		const err = new Error("普通错误");
		expect(getErrorMessage(err)).toBe("普通错误");
	});

	it('returns "未知错误" for non-Error values', () => {
		expect(getErrorMessage(null)).toBe("未知错误");
		expect(getErrorMessage(undefined)).toBe("未知错误");
		expect(getErrorMessage("string")).toBe("未知错误");
		expect(getErrorMessage(42)).toBe("未知错误");
	});
});
