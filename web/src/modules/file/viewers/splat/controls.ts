// ── 相机操作映射：键盘 / 滚轮 / 拖拽 → 相机增量 ──
//
// 逐条对齐参考实现 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）
// https://github.com/antimatter15/splat 的操作表，常量也照搬（见 STEP 与各函数注释）。
// 抽成纯函数是为了能直接测"按 A 到底是往哪转"，而不是靠肉眼看画面。
//
// 坐标约定见 matrix.ts：相机自身 +x 右、+y 下、+z 前（COLMAP 约定），
// 所以"向前"是 +z、"抬高"是 -y、翻滚是绕 +z。

import {
	invert4,
	type Mat4,
	rotate4,
	translate4,
	type Vec3,
} from "./matrix.ts";

export type CameraOp =
	/** 沿相机自身坐标轴平移 */
	| { kind: "translate"; x: number; y: number; z: number }
	/** 绕相机自身的某个轴旋转（转视角，位置不变） */
	| { kind: "rotate"; rad: number; axis: Vec3 }
	/** 绕相机前方 orbitDistance 处的点环绕（位置在动，视角跟着） */
	| { kind: "orbit"; yaw: number; pitch: number };

/** 逐帧增量（参考实现里写死的每帧常量，按 60fps 计） */
export const STEP = {
	/** 方向键上下：前进/后退 */
	forward: 0.1,
	/** 左右平移与垂直移动 */
	strafe: 0.03,
	vertical: 0.03,
	/** WASD 转视角 */
	turn: 0.01,
	tilt: 0.005,
	/** QE 翻滚 */
	roll: 0.01,
	/** IJKL 环绕 */
	orbit: 0.05,
} as const;

const AXIS_Y: Vec3 = [0, 1, 0];
const AXIS_X: Vec3 = [1, 0, 0];
const AXIS_Z: Vec3 = [0, 0, 1];

/** 这些键按下时要持续生效（需要在按住期间跑帧循环） */
export function isCameraKey(code: string): boolean {
	return KEYS.has(code);
}

const KEYS = new Set([
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"KeyW",
	"KeyA",
	"KeyS",
	"KeyD",
	"KeyQ",
	"KeyE",
	"KeyI",
	"KeyJ",
	"KeyK",
	"KeyL",
	"Space",
]);

/**
 * 键盘（`KeyboardEvent.code`）→ 每帧操作。
 * 返回 undefined 表示这个键不参与相机控制（调用方不应 preventDefault 或拦截）。
 */
export function keyOps(
	code: string,
	shiftKey: boolean,
): CameraOp[] | undefined {
	switch (code) {
		// 方向键：前进/后退/左右平移；按住 Shift 变成上下移动
		case "ArrowUp":
			return shiftKey
				? [{ kind: "translate", x: 0, y: -STEP.vertical, z: 0 }]
				: [{ kind: "translate", x: 0, y: 0, z: STEP.forward }];
		case "ArrowDown":
			return shiftKey
				? [{ kind: "translate", x: 0, y: STEP.vertical, z: 0 }]
				: [{ kind: "translate", x: 0, y: 0, z: -STEP.forward }];
		case "ArrowLeft":
			return [{ kind: "translate", x: -STEP.strafe, y: 0, z: 0 }];
		case "ArrowRight":
			return [{ kind: "translate", x: STEP.strafe, y: 0, z: 0 }];
		// WASD：A/D 左右转、W/S 前后仰、Q/E 翻滚（位置都不动）
		case "KeyA":
			return [{ kind: "rotate", rad: -STEP.turn, axis: AXIS_Y }];
		case "KeyD":
			return [{ kind: "rotate", rad: STEP.turn, axis: AXIS_Y }];
		case "KeyW":
			return [{ kind: "rotate", rad: STEP.tilt, axis: AXIS_X }];
		case "KeyS":
			return [{ kind: "rotate", rad: -STEP.tilt, axis: AXIS_X }];
		case "KeyQ":
			return [{ kind: "rotate", rad: STEP.roll, axis: AXIS_Z }];
		case "KeyE":
			return [{ kind: "rotate", rad: -STEP.roll, axis: AXIS_Z }];
		// IJKL：绕前方定点环绕
		case "KeyJ":
			return [{ kind: "orbit", yaw: -STEP.orbit, pitch: 0 }];
		case "KeyL":
			return [{ kind: "orbit", yaw: STEP.orbit, pitch: 0 }];
		case "KeyI":
			return [{ kind: "orbit", yaw: 0, pitch: STEP.orbit }];
		case "KeyK":
			return [{ kind: "orbit", yaw: 0, pitch: -STEP.orbit }];
		default:
			return undefined;
	}
}

/** 把逐帧常量按实际帧时长缩放（dt 以 1/60 秒为单位） */
export function scaleOps(ops: CameraOp[], k: number): CameraOp[] {
	return ops.map((op) => {
		if (op.kind === "translate")
			return { ...op, x: op.x * k, y: op.y * k, z: op.z * k };
		if (op.kind === "rotate") return { ...op, rad: op.rad * k };
		return { ...op, yaw: op.yaw * k, pitch: op.pitch * k };
	});
}

export interface DragInput {
	/** 1 = 左键（环绕），2 = 右键（前后 + 平移）；按住 Ctrl/Cmd 时左键也按右键算 */
	button: number;
	ctrlKey: boolean;
	metaKey: boolean;
	deltaX: number;
	deltaY: number;
	width: number;
	height: number;
}

/** 鼠标拖拽 → 操作（参考实现：左键环绕、右键前后与平移） */
export function dragOps(input: DragInput): CameraOp[] {
	const move = input.button === 2 || input.ctrlKey || input.metaKey;
	if (!move) {
		// 环绕：位移按画布尺寸归一化，手感与画布大小无关
		return [
			{
				kind: "orbit",
				yaw: (5 * input.deltaX) / input.width,
				pitch: (-5 * input.deltaY) / input.height,
			},
		];
	}
	return [
		{
			kind: "translate",
			x: (-10 * input.deltaX) / input.width,
			y: 0,
			z: (10 * input.deltaY) / input.height,
		},
	];
}

export interface WheelInput {
	deltaX: number;
	deltaY: number;
	/** 0 = 像素、1 = 行、2 = 页（浏览器给的 deltaMode） */
	deltaMode: number;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	width: number;
	height: number;
}

/** 滚轮 → 操作（参考实现：裸滚环绕、Shift 上下左右平移、Ctrl/Cmd 前后移动） */
export function wheelOps(input: WheelInput): CameraOp[] {
	// 行/页单位的滚轮换算成像素（参考实现同此）
	const scale =
		input.deltaMode === 1 ? 10 : input.deltaMode === 2 ? input.height : 1;
	const dx = (input.deltaX * scale) / input.width;
	const dy = (input.deltaY * scale) / input.height;

	if (input.shiftKey) return [{ kind: "translate", x: dx, y: dy, z: 0 }];
	if (input.ctrlKey || input.metaKey)
		return [{ kind: "translate", x: 0, y: 0, z: -10 * dy }];
	return [{ kind: "orbit", yaw: -dx, pitch: dy }];
}

/** 空格"跳"：参考实现是渐变到位（见 SplatViewer 的 jumpDelta） */
export function jumpOps(jumpDelta: number): CameraOp[] {
	if (jumpDelta === 0) return [];
	return [
		{ kind: "translate", x: 0, y: -jumpDelta, z: 0 },
		{ kind: "rotate", rad: -0.1 * jumpDelta, axis: AXIS_X },
	];
}

/**
 * 把操作施加到视图矩阵上（世界 → 相机）。
 * 做法与参考实现一致：**在相机自身坐标系里改逆矩阵**，再取逆回来。
 * `orbitDistance` 是环绕中心到相机的距离（取景时按包围球定）。
 */
export function applyOps(
	view: Mat4,
	ops: readonly CameraOp[],
	orbitDistance: number,
): Mat4 {
	let inv = invert4(view);
	if (!inv) return view;
	for (const op of ops) {
		if (op.kind === "translate") {
			inv = translate4(inv, op.x, op.y, op.z);
			continue;
		}
		if (op.kind === "rotate") {
			inv = rotate4(inv, op.rad, op.axis[0], op.axis[1], op.axis[2]);
			continue;
		}
		// 环绕：先把相机推到"以定点为原点"的坐标系，转完再退回来
		const d = orbitDistance;
		const toPivot = translate4(inv, 0, 0, d);
		let rotated = toPivot;
		if (op.yaw) rotated = rotate4(rotated, op.yaw, 0, 1, 0);
		if (op.pitch) rotated = rotate4(rotated, op.pitch, 1, 0, 0);
		inv = translate4(rotated, 0, 0, -d);
	}
	return invert4(inv) ?? view;
}
