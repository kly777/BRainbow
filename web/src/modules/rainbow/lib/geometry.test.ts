import { describe, expect, it, vi, beforeEach } from "vitest";
import { rainbowGeometry, RAINBOW_SQUARE_SIZE } from "./geometry.ts";

describe("rainbow geometry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("计算彩虹几何尺寸", async () => {
		// 测试计算彩虹几何尺寸
		const result = rainbowGeometry(400, Math.PI * (43.5 / 360), 7);

		// 验证返回结果
		expect(result).toBeDefined();
		expect(result.rectWidth).toBeDefined();
		expect(result.rectHeight).toBeDefined();
		expect(result.heightSum).toBeDefined();

		// 验证数值类型
		expect(typeof result.rectWidth).toBe("number");
		expect(typeof result.rectHeight).toBe("number");
		expect(typeof result.heightSum).toBe("number");

		// 验证数值范围
		expect(result.rectWidth).toBeGreaterThan(0);
		expect(result.rectHeight).toBeGreaterThan(0);
		expect(result.heightSum).toBeGreaterThan(0);
	});

	it("计算矩形宽度和高度", async () => {
		// 测试计算矩形宽度和高度
		const squareSize = 400;
		const angle = Math.PI * (43.5 / 360);
		const colorCount = 7;

		const result = rainbowGeometry(squareSize, angle, colorCount);

		// 验证矩形宽度
		expect(result.rectWidth).toBeGreaterThan(0);

		// 验证矩形高度
		expect(result.rectHeight).toBeGreaterThan(0);
		expect(result.rectHeight).toBeLessThanOrEqual(squareSize);
	});

	it("计算总高度", async () => {
		// 测试计算总高度
		const squareSize = 400;
		const angle = Math.PI * (43.5 / 360);
		const colorCount = 7;

		const result = rainbowGeometry(squareSize, angle, colorCount);

		// 验证总高度
		expect(result.heightSum).toBeGreaterThan(0);
		expect(result.heightSum).toBeLessThanOrEqual(squareSize * colorCount);
	});

	it("常量RAINSQUARE_SIZE存在", async () => {
		// 测试常量RAINSQUARE_SIZE存在
		expect(RAINBOW_SQUARE_SIZE).toBeDefined();
		expect(typeof RAINBOW_SQUARE_SIZE).toBe("number");
		expect(RAINBOW_SQUARE_SIZE).toBeGreaterThan(0);
	});
});
