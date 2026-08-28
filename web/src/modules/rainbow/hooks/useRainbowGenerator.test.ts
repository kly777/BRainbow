import { createRoot } from "solid-js";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useRainbowGenerator } from "./useRainbowGenerator.ts";

// 模拟依赖
vi.mock("@shared/utils", () => ({
	Color: {
		fromOklch: vi.fn((oklch) => ({
			oklch,
			toHex: () => "#000000",
		})),
	},
	Angle: class Angle {
		constructor(radian) {
			this.radian = radian;
			this.degree = radian * (180 / Math.PI);
		}
	},
}));

vi.mock("../lib/geometry.ts", () => ({
	RAINBOW_SQUARE_SIZE: 400,
	rainbowGeometry: vi.fn(() => ({
		rectWidth: 100,
		rectHeight: 50,
		heightSum: 350,
	})),
}));

describe("useRainbowGenerator", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("管理彩虹生成器状态", async () => {
		// 测试管理彩虹生成器状态
		await createRoot(async (dispose) => {
			try {
				const generator = useRainbowGenerator();

				// 验证初始状态
				expect(generator.colors().length).toBe(7);
				expect(generator.angle()).toBeDefined();
				expect(generator.shapeRender()).toBe("geometricPrecision");
			} finally {
				dispose();
			}
		});
	});

	it("处理颜色生成", async () => {
		// 测试处理颜色生成
		await createRoot(async (dispose) => {
			try {
				const generator = useRainbowGenerator();

				// 验证颜色生成
				const colors = generator.colors();
				expect(colors.length).toBe(7);

				// 验证每个颜色都有oklch属性
				colors.forEach((color) => {
					expect(color.oklch).toBeDefined();
				});
			} finally {
				dispose();
			}
		});
	});

	it("管理角度和渐变", async () => {
		// 测试管理角度和渐变
		await createRoot(async (dispose) => {
			try {
				const generator = useRainbowGenerator();

				// 验证初始角度
				expect(generator.angle().radian).toBeDefined();
				expect(generator.angle().degree).toBeDefined();

				// 设置新角度
				const { Angle } = await import("@shared/utils");
				const newAngle = new Angle(Math.PI * (90 / 360));
				generator.setAngle(newAngle);

				// 验证角度更新
				expect(generator.angle()).toBe(newAngle);
			} finally {
				dispose();
			}
		});
	});

	it("导出SVG和PNG", async () => {
		// 测试导出SVG和PNG
		await createRoot(async (dispose) => {
			try {
				const generator = useRainbowGenerator();

				// 验证导出函数存在
				expect(typeof generator.exportSvg).toBe("function");
				expect(typeof generator.exportPng).toBe("function");
				expect(typeof generator.bindSvg).toBe("function");
			} finally {
				dispose();
			}
		});
	});
});
