import { describe, it, expect, vi } from "vitest";
import {
  NetworkError,
  HttpError,
  ValidationError,
  getErrorMessage,
  showErrorInline,
} from "./errors.ts";

// showErrorAlert 会 import { showToast } from toastStore，
// 用 vi.mock 避免 SolidJS 依赖
vi.mock("../../components/ui/toastStore.ts", () => ({
  showToast: vi.fn(),
}));

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

describe("showErrorInline", () => {
  it("returns error message without prefix", () => {
    const err = new HttpError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "标题不能为空",
    });
    expect(showErrorInline(err)).toBe("标题不能为空");
  });

  it("returns error message with prefix", () => {
    const err = new HttpError({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "标题不能为空",
    });
    expect(showErrorInline(err, "创建任务")).toBe("创建任务: 标题不能为空");
  });

  it("works with NetworkError", () => {
    const err = new NetworkError({ cause: "timeout" });
    expect(showErrorInline(err)).toBe("网络连接失败，请检查网络");
  });
});
