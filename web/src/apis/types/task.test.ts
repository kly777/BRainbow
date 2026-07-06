import { describe, it, expect } from "vitest";
import { getStatusText, TaskStatus } from "./task.ts";

describe("TaskStatus constants", () => {
  it("has correct values", () => {
    expect(TaskStatus.BACKLOG).toBe("backlog");
    expect(TaskStatus.ACTIVE).toBe("active");
    expect(TaskStatus.COMPLETED).toBe("completed");
    expect(TaskStatus.ARCHIVED).toBe("archived");
  });
});

describe("getStatusText", () => {
  it('returns "待办" for backlog', () => {
    expect(getStatusText("backlog")).toBe("待办");
  });

  it('returns "进行中" for active', () => {
    expect(getStatusText("active")).toBe("进行中");
  });

  it('returns "已完成" for completed', () => {
    expect(getStatusText("completed")).toBe("已完成");
  });

  it('returns "已归档" for archived', () => {
    expect(getStatusText("archived")).toBe("已归档");
  });

  it('returns "未知" for unknown status', () => {
    expect(getStatusText("unknown")).toBe("未知");
    expect(getStatusText("")).toBe("未知");
    expect(getStatusText("deleted")).toBe("未知");
  });
});
