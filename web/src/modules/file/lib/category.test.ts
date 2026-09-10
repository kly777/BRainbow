// ── categoryLabel：分类枚举 → 中文展示名 ──

import { describe, expect, it } from "vitest";
import type { FileCategory } from "../api.ts";
import { categoryLabel } from "./category.ts";

describe("categoryLabel", () => {
	it("覆盖全部 5 个分类且不为空", () => {
		const all: FileCategory[] = [
			"image",
			"video",
			"audio",
			"document",
			"other",
		];
		for (const category of all) {
			expect(categoryLabel(category)).toBeTruthy();
		}
	});

	it("返回中文名", () => {
		expect(categoryLabel("image")).toBe("图片");
		expect(categoryLabel("other")).toBe("其他");
	});
});
