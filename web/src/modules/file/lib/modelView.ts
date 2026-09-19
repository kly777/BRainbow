// ── 3D 模型的预设视角（纯函数） ──
//
// "复位"与"从正面/上面/侧面看"是最常用的三种动作：模型转晕了要能回到原位，
// 想看某个面而不必用鼠标找角度。这里只算**方向与距离**，具体设相机由查看器做。

/** 预设方向（未归一化，具体长度无关紧要，取景距离另有算法） */
export const VIEW_DIRECTIONS = {
	/** 等轴测：与初始机位一致（三个轴都有分量，最容易看清整体形状） */
	iso: [1, 2, 1.5],
	front: [0, 0, 1],
	top: [0, 1, 0],
	side: [1, 0, 0],
} as const;

export type ViewPreset = keyof typeof VIEW_DIRECTIONS;
export const VIEW_PRESETS: ViewPreset[] = ["iso", "front", "top", "side"];

export const VIEW_PRESET_LABELS: Record<ViewPreset, string> = {
	iso: "等轴",
	front: "正视",
	top: "俯视",
	side: "侧视",
};

export type Vec3 = readonly [number, number, number];

/** 归一化；零向量退回 +z（否则相机与目标重合，画面会变成一片黑） */
export function normalize(vec: readonly number[]): Vec3 {
	const [x = 0, y = 0, z = 0] = vec;
	const length = Math.hypot(x, y, z);
	if (length < 1e-9) return [0, 0, 1];
	return [x / length, y / length, z / length];
}

/** 相机位置 = 目标中心 + 单位方向 × 距离 */
export function cameraPositionFor(
	center: Vec3,
	dir: readonly number[],
	distance: number,
): Vec3 {
	const unit = normalize(dir);
	return [
		center[0] + unit[0] * distance,
		center[1] + unit[1] * distance,
		center[2] + unit[2] * distance,
	];
}

/** 俯视时视线与"上方向"平行，相机会翻滚 —— 这种角度改用 -z 当上方向 */
export function upVectorFor(dir: readonly number[]): Vec3 {
	const unit = normalize(dir);
	return Math.abs(unit[1]) > 0.99 ? [0, 0, -1] : [0, 1, 0];
}
