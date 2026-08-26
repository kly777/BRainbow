// ── 彩虹几何：色带尺寸的单一计算来源（绘制与统计共用） ──

/** 导出/绘制的 viewBox 边长 */
export const RAINBOW_SQUARE_SIZE = 10240;

export interface RainbowGeometry {
	heightSum: number;
	rectHeight: number;
	rectWidth: number;
	yOffset: number;
}

export function rainbowGeometry(
	size: number,
	radian: number,
	count: number,
): RainbowGeometry {
	const heightSum = size * (Math.sin(radian) + Math.cos(radian));
	const rectHeight = heightSum / count;
	const rectWidth = size / Math.cos(radian) + 2 * rectHeight * Math.tan(radian);
	const yOffset = rectHeight / Math.cos(radian);
	return { heightSum, rectHeight, rectWidth, yOffset };
}
