import { describe, expect, it } from "vitest";
import type { Task } from "../api-types.ts";
import { toUpdatePayload } from "./task-payload.ts";

const task = (over: Partial<Task> = {}): Partial<Task> => ({
	title: "写周报",
	...over,
});

describe("toUpdatePayload", () => {
	it("tags 从对象数组换成名字数组", () => {
		const payload = toUpdatePayload(
			task({
				tags: [
					{ id: 1, name: "工作" },
					{ id: 2, name: "急" },
				],
			}),
		);
		expect(payload.tags).toEqual(["工作", "急"]);
	});

	it("空标签集传空数组（整体替换语义：清空）", () => {
		expect(toUpdatePayload(task({ tags: [] })).tags).toEqual([]);
	});

	it("没带 tags 就不发这个字段（不改动）", () => {
		expect("tags" in toUpdatePayload(task())).toBe(false);
	});

	it("其余字段原样透传", () => {
		const payload = toUpdatePayload(
			task({
				description: "x",
				priority: "p1",
				due_at: "2026-10-09T15:00:00Z",
			}),
		);
		expect(payload.description).toBe("x");
		expect(payload.priority).toBe("p1");
		expect(payload.due_at).toBe("2026-10-09T15:00:00Z");
	});

	it("显式 null（清空）原样带上，不被当成缺省丢掉", () => {
		const payload = toUpdatePayload(task({ due_at: null }));
		expect("due_at" in payload).toBe(true);
		expect(payload.due_at).toBeNull();
	});
});
