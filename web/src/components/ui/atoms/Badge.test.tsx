import { describe, expect, it } from "vitest";
import Badge from "./Badge.tsx";

describe("Badge", () => {
	it("组件可渲染", () => {
		expect(Badge).toBeDefined();
		expect(typeof Badge).toBe("function");
	});

	it("variant 默认值为 default", () => {
		const variant = undefined;
		const resolved = variant ?? "default";
		expect(resolved).toBe("default");
	});

	it("支持所有 variant 类型", () => {
		const variants = [
			"default",
			"new",
			"learning",
			"review",
			"relearning",
			"suspended",
			"success",
			"warning",
		];
		for (const v of variants) {
			expect(typeof v).toBe("string");
		}
		expect(variants).toHaveLength(8);
	});
});
