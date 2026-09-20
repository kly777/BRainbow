// ── 相机操作映射：键盘 / 滚轮 / 拖拽 → 相机增量 ──
//
// 逐条对齐参考实现 antimatter15/splat（MIT License, Copyright (c) 2023 Kevin Kwok）
// https://github.com/antimatter15/splat 的操作表，常量也照搬（见 STEP 与各函数注释）。
// 抽成纯函数是为了能直接测"按 A 到底是往哪转"，而不是靠肉眼看画面。
//
// 坐标约定见 matrix.ts：相机自身 +x 右、+y 下、+z 前（COLMAP 约定），
// 所以"向前"是 +z、"抬高"是 -y、翻滚是绕 +z。
//
// 键盘有两套映射（`MoveMode`），差别只在"移动"这一半：
//   · "view"（默认，同参考实现）：一切沿**相机自身**的轴 —— 抬头往前走就是往上飞；
//   · "horizontal"（水平锁定）：移动只发生在**世界水平面**上，升降交给空格/Shift。
// 视角（拖拽/滚轮/IJKL 环绕）两套一致。

import {
	cross,
	dot,
	inPlane,
	invert4,
	type Mat4,
	rotate4,
	rotateVec,
	translate4,
	translateWorld,
	type Vec3,
	WORLD_UP,
} from "./matrix.ts";

/**
 * 移动模式：
 * - `"view"`：任何方向的移动都相对**视角**（参考实现的行为，抬头走就是往上飞）
 * - `"horizontal"`：移动发生在**一块"地面"上**（像 MC 那样贴地走）：视角只决定
 *   往哪个方向走，`QE` 的翻滚会把这块地面一起转过去（见 `planeFrame`）
 */
export type MoveMode = "view" | "horizontal";

export type CameraOp =
	/** 沿相机自身坐标轴平移 */
	| { kind: "translate"; x: number; y: number; z: number }
	/** 绕相机自身的某个轴旋转（转视角，位置不变） */
	| { kind: "rotate"; rad: number; axis: Vec3 }
	/** 绕相机前方 orbitDistance 处的点环绕（位置在动，视角跟着） */
	| { kind: "orbit"; yaw: number; pitch: number }
	/**
	 * 在**移动平面**里移动（水平锁定模式）。三个分量按平面自己的方向组合：
	 * 前 / 右 / 上（见 `planeFrame`）。平面默认是世界水平面，`QE` 翻滚能把它转过去，
	 * 所以这里的"上"不一定等于世界垂直方向。
	 */
	| { kind: "planeMove"; forward: number; right: number; up: number };

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
 *
 * `mode` 决定移动类按键的含义（转视角的按键两套一致），见 `MoveMode`。
 */
export function keyOps(
	code: string,
	shiftKey: boolean,
	mode: MoveMode = "view",
): CameraOp[] | undefined {
	return mode === "horizontal"
		? horizontalKeyOps(code)
		: viewKeyOps(code, shiftKey);
}

/** 水平锁定模式的映射：WASD/方向键在"地面"上走，空格升、Shift 降 */
function horizontalKeyOps(code: string): CameraOp[] | undefined {
	switch (code) {
		// 前后左右都在移动平面内：视角只决定"前"是哪个方向
		case "ArrowUp":
		case "KeyW":
			return [{ kind: "planeMove", forward: STEP.forward, right: 0, up: 0 }];
		case "ArrowDown":
		case "KeyS":
			return [{ kind: "planeMove", forward: -STEP.forward, right: 0, up: 0 }];
		case "ArrowLeft":
		case "KeyA":
			return [{ kind: "planeMove", forward: 0, right: -STEP.strafe, up: 0 }];
		case "ArrowRight":
		case "KeyD":
			return [{ kind: "planeMove", forward: 0, right: STEP.strafe, up: 0 }];
		// 升降沿平面的法线（= 平面的"上"）。平面没被翻滚时它就是世界垂直方向，
		// 翻滚过之后跟着一起歪 —— 所以这里不写死世界坐标轴
		case "Space":
			return [{ kind: "planeMove", forward: 0, right: 0, up: STEP.vertical }];
		case "ShiftLeft":
		case "ShiftRight":
			return [{ kind: "planeMove", forward: 0, right: 0, up: -STEP.vertical }];
		// 翻滚照旧：绕视线轴转，地平线跟着歪（地面也跟着转，见 planeFrame）
		case "KeyQ":
			return [{ kind: "rotate", rad: STEP.roll, axis: AXIS_Z }];
		case "KeyE":
			return [{ kind: "rotate", rad: -STEP.roll, axis: AXIS_Z }];
		// IJKL 环绕是"看"不是"走"，两套模式一致
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

/** 视角相对模式（参考实现的操作表）：一切沿相机自身的轴 */
function viewKeyOps(code: string, shiftKey: boolean): CameraOp[] | undefined {
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
		if (op.kind === "planeMove")
			return {
				...op,
				forward: op.forward * k,
				right: op.right * k,
				up: op.up * k,
			};
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
 * 相机的"移动平面"坐标系 —— 水平锁定模式（MC 那样"有块地面"）的全部依据。
 *
 * 平面默认就是**世界水平面**：抬头低头只是换视角，"地面"不跟着翻，所以低头看脚下
 * 不会往地里钻，按前进就是贴着地面走。但 `QE` 的**翻滚**会把它一起转过去
 * （地平线歪了，地面跟着歪）：平面法线于是偏离世界垂直，升降也跟着倾斜。
 * 俯仰**不**参与 —— 这正是"视角只影响水平移动的方向"的意思。
 *
 * 三个轴：`normal`（平面法线 = 平面里的"上"）、`forward`（平面内，视线方向在平面里的
 * 投影）、`right`（平面内，与前两者成右手系）。视图矩阵的三行就是相机各轴在世界里的
 * 方向，所以不必求逆矩阵。
 */
function planeFrame(view: Mat4): { forward: Vec3; right: Vec3; normal: Vec3 } {
	const f: Vec3 = [view[2], view[6], view[10]]; // 视线方向
	const camUp: Vec3 = [-view[1], -view[5], -view[9]]; // 相机的"上"（第二行是"下"）
	const camRight: Vec3 = [view[0], view[4], view[8]];

	// "没有翻滚时的上"：世界朝上里垂直于视线的分量。正对上下看时它退化，
	// 而那种姿态下"滚了多少"本来就没有参照，于是当没有翻滚
	const flatUp = inPlane(WORLD_UP, f) ?? camUp;
	// 相机绕视线轴实际滚过的角度（带符号）：从"没有翻滚的上"转到"相机的上"
	const roll = Math.atan2(dot(cross(flatUp, camUp), f), dot(flatUp, camUp));
	// 平面法线 = 世界朝上被同样角度滚过去（所以俯仰不参与）
	const normal = rotateVec(WORLD_UP, roll, f);
	// 平面内的前向 = 视线在平面里的投影；正对上下看时退回相机的上 / 右
	const forward =
		inPlane(f, normal) ??
		inPlane(camUp, normal) ??
		inPlane(camRight, normal) ??
		([0, 0, 1] as Vec3);
	return { forward, right: cross(forward, normal), normal };
}

/**
 * 把操作施加到视图矩阵上（世界 → 相机）。
 * 做法与参考实现一致：**在相机自身坐标系里改逆矩阵**，再取逆回来。
 * `orbitDistance` 是环绕中心到相机的距离（取景时按取景距离的比例定）。
 */
export function applyOps(
	view: Mat4,
	ops: readonly CameraOp[],
	orbitDistance: number,
): Mat4 {
	let inv = invert4(view);
	if (!inv) return view;
	// 同一帧里的平面移动共用一个朝向（本帧开始时相机在哪、朝向如何）
	const plane = planeFrame(view);
	for (const op of ops) {
		if (op.kind === "translate") {
			inv = translate4(inv, op.x, op.y, op.z);
			continue;
		}
		if (op.kind === "rotate") {
			inv = rotate4(inv, op.rad, op.axis[0], op.axis[1], op.axis[2]);
			continue;
		}
		if (op.kind === "planeMove") {
			const v: Vec3 = [
				plane.forward[0] * op.forward +
					plane.right[0] * op.right +
					plane.normal[0] * op.up,
				plane.forward[1] * op.forward +
					plane.right[1] * op.right +
					plane.normal[1] * op.up,
				plane.forward[2] * op.forward +
					plane.right[2] * op.right +
					plane.normal[2] * op.up,
			];
			// 沿世界坐标平移（不是相机自身坐标）—— 姿态因此不影响走出来的方向
			inv = translateWorld(inv, v);
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
