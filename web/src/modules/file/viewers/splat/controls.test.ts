// ── 操作映射（纯函数直测） ──
// 这张表就是"按 A 会往哪转"的契约：逐条对齐参考实现 antimatter15/splat。
// 坐标约定：相机 +x 右、+y 下、+z 前 —— 所以"抬高"是 -y、"向前"是 +z。

import { describe, expect, it } from "vitest";
import {
	applyOps,
	dragOps,
	isCameraKey,
	jumpOps,
	keyOps,
	STEP,
	scaleOps,
	wheelOps,
} from "./controls.ts";
import { dot, invert4, type Mat4, viewMatrix } from "./matrix.ts";

/** -0 与 0 数学等价但 toEqual 会区分；用 JSON 往返把它归一（-0 → 0） */
const norm = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** 相机在 -z 侧朝 +z 看（初始取景就是这种位姿） */
const baseView = (): Mat4 => viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);

/** 视图矩阵的逆矩阵的平移列 = 相机位置 */
const cameraPos = (view: Mat4): [number, number, number] => {
	const inv = invert4(view);
	if (!inv) throw new Error("视图矩阵不可逆");
	return [inv[12], inv[13], inv[14]];
};

/** 视图矩阵第三行 = 相机前向轴 */
const forward = (view: Mat4): [number, number, number] => [
	view[2],
	view[6],
	view[10],
];

describe("keyOps：方向键", () => {
	it("上下是前后移动，左右是横向平移", () => {
		expect(norm(keyOps("ArrowUp", false))).toEqual([
			{ kind: "translate", x: 0, y: 0, z: STEP.forward },
		]);
		expect(norm(keyOps("ArrowDown", false))).toEqual([
			{ kind: "translate", x: 0, y: 0, z: -STEP.forward },
		]);
		expect(norm(keyOps("ArrowLeft", false))).toEqual([
			{ kind: "translate", x: -STEP.strafe, y: 0, z: 0 },
		]);
		expect(norm(keyOps("ArrowRight", false))).toEqual([
			{ kind: "translate", x: STEP.strafe, y: 0, z: 0 },
		]);
	});

	it("按住 Shift 时上下变成垂直移动（y 轴朝下，抬高是 -y）", () => {
		expect(norm(keyOps("ArrowUp", true))).toEqual([
			{ kind: "translate", x: 0, y: -STEP.vertical, z: 0 },
		]);
		expect(norm(keyOps("ArrowDown", true))).toEqual([
			{ kind: "translate", x: 0, y: STEP.vertical, z: 0 },
		]);
	});

	it("真的把相机往前推（+z 是前方）", () => {
		const moved = applyOps(baseView(), keyOps("ArrowUp", false) ?? [], 4);
		const [x, y, z] = cameraPos(moved);
		expect(x).toBeCloseTo(0, 5);
		expect(y).toBeCloseTo(0, 5);
		expect(z).toBeGreaterThan(-5); // 朝 +z 前进了
	});
});

describe("keyOps：WASD 与 QE", () => {
	it("A/D 绕相机 y 轴转、W/S 绕 x 轴仰俯、Q/E 绕 z 轴翻滚", () => {
		expect(norm(keyOps("KeyA", false))).toEqual([
			{ kind: "rotate", rad: -STEP.turn, axis: [0, 1, 0] },
		]);
		expect(norm(keyOps("KeyD", false))).toEqual([
			{ kind: "rotate", rad: STEP.turn, axis: [0, 1, 0] },
		]);
		expect(norm(keyOps("KeyW", false))).toEqual([
			{ kind: "rotate", rad: STEP.tilt, axis: [1, 0, 0] },
		]);
		expect(norm(keyOps("KeyS", false))).toEqual([
			{ kind: "rotate", rad: -STEP.tilt, axis: [1, 0, 0] },
		]);
		expect(norm(keyOps("KeyQ", false))).toEqual([
			{ kind: "rotate", rad: STEP.roll, axis: [0, 0, 1] },
		]);
		expect(norm(keyOps("KeyE", false))).toEqual([
			{ kind: "rotate", rad: -STEP.roll, axis: [0, 0, 1] },
		]);
	});

	it("转视角时位置不动（原地转身/仰俯/翻滚）", () => {
		for (const code of ["KeyA", "KeyD", "KeyW", "KeyS", "KeyQ", "KeyE"]) {
			const view = applyOps(baseView(), keyOps(code, false) ?? [], 4);
			const [x, y, z] = cameraPos(view);
			// Float32 精度下位置是"基本不变"，不是严格逐位相等
			expect(x).toBeCloseTo(0, 5);
			expect(y).toBeCloseTo(0, 5);
			expect(z).toBeCloseTo(-5, 5);
		}
	});

	it("Q/E 真的产生翻滚：前向轴不变，但相机的右/上轴转了", () => {
		const view = baseView();
		const rolled = applyOps(view, keyOps("KeyQ", false) ?? [], 4);
		// 绕视线轴翻滚不改变看的方向
		expect(forward(rolled)[0]).toBeCloseTo(forward(view)[0], 6);
		expect(forward(rolled)[2]).toBeCloseTo(forward(view)[2], 6);
		// 但"右"轴出现了垂直分量（画面歪了）
		const rightBefore = [view[0], view[4], view[8]];
		const rightAfter = [rolled[0], rolled[4], rolled[8]];
		expect(Math.abs(rightBefore[1])).toBeLessThan(1e-6);
		expect(Math.abs(rightAfter[1])).toBeGreaterThan(1e-3);
	});
});

describe("keyOps：IJKL 环绕", () => {
	it("J/L 绕 y 轴环绕、I/K 绕 x 轴环绕", () => {
		expect(norm(keyOps("KeyJ", false))).toEqual([
			{ kind: "orbit", yaw: -STEP.orbit, pitch: 0 },
		]);
		expect(norm(keyOps("KeyL", false))).toEqual([
			{ kind: "orbit", yaw: STEP.orbit, pitch: 0 },
		]);
		expect(norm(keyOps("KeyI", false))).toEqual([
			{ kind: "orbit", yaw: 0, pitch: STEP.orbit },
		]);
		expect(norm(keyOps("KeyK", false))).toEqual([
			{ kind: "orbit", yaw: 0, pitch: -STEP.orbit },
		]);
	});

	it("环绕时相机到环绕中心的距离保持不变", () => {
		const d = 4;
		const view = baseView();
		// 环绕中心 = 初始相机位置前方 d 处
		const [cx, cy, cz] = cameraPos(view);
		const f = forward(view);
		const pivot = [cx + d * f[0], cy + d * f[1], cz + d * f[2]];

		const orbited = applyOps(view, keyOps("KeyL", false) ?? [], d);
		const [x, y, z] = cameraPos(orbited);
		expect(Math.hypot(x - pivot[0], y - pivot[1], z - pivot[2])).toBeCloseTo(
			d,
			4,
		);
		// 视角确实转了，而相机不再停在原来的位置上
		expect(Math.abs(forward(orbited)[0])).toBeGreaterThan(0);
		expect(x).not.toBeCloseTo(cx, 4);
	});
});

describe("keyOps：其它键", () => {
	it("不参与相机控制的键返回 undefined（调用方不该拦截它）", () => {
		expect(keyOps("KeyZ", false)).toBeUndefined();
		expect(keyOps("Escape", false)).toBeUndefined();
		expect(keyOps("ArrowUp", false)).toBeDefined();
	});

	it("空格算相机键（由调用方做渐变），但自身不产出逐帧操作", () => {
		expect(isCameraKey("Space")).toBe(true);
		expect(keyOps("Space", false)).toBeUndefined();
		expect(jumpOps(0)).toEqual([]);
		expect(jumpOps(1)).toEqual([
			{ kind: "translate", x: 0, y: -1, z: 0 },
			{ kind: "rotate", rad: -0.1, axis: [1, 0, 0] },
		]);
	});

	it("识别所有相机键", () => {
		for (const code of [
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
		])
			expect(isCameraKey(code)).toBe(true);
		expect(isCameraKey("KeyZ")).toBe(false);
	});
});

describe("keyOps：水平锁定模式", () => {
	it("WASD 与方向键都变成在地面上移动（不再转视角）", () => {
		expect(norm(keyOps("KeyW", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: STEP.forward, right: 0, up: 0 },
		]);
		expect(norm(keyOps("KeyS", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: -STEP.forward, right: 0, up: 0 },
		]);
		expect(norm(keyOps("KeyA", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: 0, right: -STEP.strafe, up: 0 },
		]);
		expect(norm(keyOps("KeyD", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: 0, right: STEP.strafe, up: 0 },
		]);
		// 方向键与 WASD 同义（这一模式下方向键也不转视角）
		expect(norm(keyOps("ArrowUp", false, "horizontal"))).toEqual(
			norm(keyOps("KeyW", false, "horizontal")),
		);
		expect(norm(keyOps("ArrowLeft", false, "horizontal"))).toEqual(
			norm(keyOps("KeyA", false, "horizontal")),
		);
	});

	it("空格升、Shift 降：沿平面的法线（不是写死的世界坐标轴）", () => {
		expect(norm(keyOps("Space", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: 0, right: 0, up: STEP.vertical },
		]);
		expect(norm(keyOps("ShiftLeft", false, "horizontal"))).toEqual([
			{ kind: "planeMove", forward: 0, right: 0, up: -STEP.vertical },
		]);
		expect(norm(keyOps("ShiftRight", false, "horizontal"))).toEqual(
			norm(keyOps("ShiftLeft", false, "horizontal")),
		);
		// 视角相对模式下 Shift 只是修饰键（配合方向键升降），自身不产出操作
		expect(keyOps("ShiftLeft", false, "view")).toBeUndefined();
	});

	it("QE 仍是翻滚、IJKL 仍是环绕（两套模式共用）", () => {
		for (const code of ["KeyQ", "KeyE", "KeyI", "KeyJ", "KeyK", "KeyL"])
			expect(norm(keyOps(code, false, "horizontal"))).toEqual(
				norm(keyOps(code, false, "view")),
			);
	});

	it("不参与相机控制的键在两种模式下都返回 undefined", () => {
		expect(keyOps("KeyZ", false, "horizontal")).toBeUndefined();
		expect(keyOps("Escape", false, "horizontal")).toBeUndefined();
	});
});

/** 俯仰过的相机（抬头 0.6 rad，没有翻滚）：用来验证"地面不跟着俯仰翻" */
const pitchedView = (): Mat4 => {
	const view = viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);
	return applyOps(view, [{ kind: "rotate", rad: 0.6, axis: [1, 0, 0] }], 4);
};

/** 俯仰 + 翻滚过的相机：用来验证"翻滚会把地面一起转过去" */
const rolledView = (roll: number): Mat4 => {
	const view = viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);
	return applyOps(
		view,
		[
			{ kind: "rotate", rad: 0.3, axis: [1, 0, 0] }, // 先抬头一点
			{ kind: "rotate", rad: roll, axis: [0, 0, 1] }, // 再翻滚
		],
		4,
	);
};

/** 与"世界垂直方向"的夹角（度）：升降是否还沿世界上下 */
const angleFromVertical = (v: [number, number, number]) => {
	const length = Math.hypot(v[0], v[1], v[2]) || 1;
	const unit = [v[0] / length, v[1] / length, v[2] / length] as const;
	return (Math.acos(Math.min(1, Math.abs(unit[1]))) * 180) / Math.PI;
};

describe("applyOps：水平锁定模式的移动", () => {
	it("在地面上走：高度（世界 y）与朝向都不变", () => {
		const before = pitchedView();
		const [bx, by, bz] = cameraPos(before);
		const after = applyOps(
			before,
			[{ kind: "planeMove", forward: 1, right: 0, up: 0 }],
			4,
		);
		const [ax, ay, az] = cameraPos(after);
		// 高度锁死 —— 这正是这一模式的全部意义
		expect(ay).toBeCloseTo(by, 5);
		// 位移长度为 1 且落在水平面里
		expect(Math.hypot(ax - bx, az - bz)).toBeCloseTo(1, 5);
		// 朝向不受影响（移动不该转视角）
		expect(norm([...forward(after)].map((v) => Number(v.toFixed(5))))).toEqual(
			norm([...forward(before)].map((v) => Number(v.toFixed(5)))),
		);
	});

	it("前进方向 = 视线在地面上的投影（俯仰不参与）", () => {
		const level = viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);
		// 低头 0.6 rad：视线里混进了垂直分量，但它不该影响"往哪走"
		const pitched = applyOps(
			level,
			[{ kind: "rotate", rad: 0.6, axis: [1, 0, 0] }],
			4,
		);
		const [bx, by, bz] = cameraPos(pitched);
		const moved = applyOps(
			pitched,
			[{ kind: "planeMove", forward: 2, right: 0, up: 0 }],
			4,
		);
		const [ax, ay, az] = cameraPos(moved);
		// 相机原本朝 +z、俯仰只是把它压低 → 前进仍落在 +z 上，长度 2
		expect(ax).toBeCloseTo(bx, 5);
		expect(az - bz).toBeCloseTo(2, 5);
		expect(ay).toBeCloseTo(by, 5);
	});

	it("侧移长度为 right，与 forward 分量互不干扰", () => {
		const view = pitchedView();
		const [bx, by, bz] = cameraPos(view);
		const moved = applyOps(
			view,
			[{ kind: "planeMove", forward: 0, right: 3, up: 0 }],
			4,
		);
		const [ax, ay, az] = cameraPos(moved);
		expect(ay).toBeCloseTo(by, 5);
		expect(Math.hypot(ax - bx, az - bz)).toBeCloseTo(3, 5);
	});

	it("没有翻滚时升降就是世界垂直方向（MC 那种“空格上升”）", () => {
		// 先用俯仰验证：俯仰不该让升降轴歪掉
		for (const view of [
			pitchedView(),
			viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]),
		]) {
			const [bx, by, bz] = cameraPos(view);
			const moved = applyOps(
				view,
				[{ kind: "planeMove", forward: 0, right: 0, up: 1 }],
				4,
			);
			const [ax, ay, az] = cameraPos(moved);
			expect(ax).toBeCloseTo(bx, 6);
			expect(az).toBeCloseTo(bz, 6);
			// 世界 y 朝下 → "上"是 -y
			expect(ay - by).toBeCloseTo(-1, 6);
		}
	});

	it("QE 翻滚会把地面一起转过去：升降轴跟着歪、角度等于翻滚角", () => {
		const level = viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);
		const roll = 0.5;
		const rolled = applyOps(
			level,
			[{ kind: "rotate", rad: roll, axis: [0, 0, 1] }],
			4,
		);
		const [bx, by, bz] = cameraPos(rolled);
		const moved = applyOps(
			rolled,
			[{ kind: "planeMove", forward: 0, right: 0, up: 1 }],
			4,
		);
		const [ax, ay, az] = cameraPos(moved);
		const delta: [number, number, number] = [ax - bx, ay - by, az - bz];
		// 位移长度仍是 1，但方向偏离世界垂直方向约等于翻滚角
		expect(Math.hypot(...delta)).toBeCloseTo(1, 5);
		expect(angleFromVertical(delta)).toBeCloseTo((roll * 180) / Math.PI, 1);
		// 且仍然垂直于视线（"升降"不该改变视线方向）
		expect(Math.abs(dot(delta, forward(rolled)))).toBeLessThan(1e-6);
	});

	it("翻滚后地面内的前后左右也跟着转（不是只歪了升降轴）", () => {
		const rolled = rolledView(0.5);
		const [bx, by, bz] = cameraPos(rolled);
		const moved = applyOps(
			rolled,
			[{ kind: "planeMove", forward: 0, right: 1, up: 0 }],
			4,
		);
		const [ax, ay, az] = cameraPos(moved);
		// 侧移不再严格水平（地面被转过去了），但长度仍是 1、且垂直于平面法线
		expect(Math.hypot(ax - bx, ay - by, az - bz)).toBeCloseTo(1, 5);
		expect(angleFromVertical([ax - bx, ay - by, az - bz])).toBeGreaterThan(1);
	});

	it("正对上下看（视线的平面投影退化）时仍能移动", () => {
		const level = viewMatrix([0, 0, -5], [0, 0, 0], [0, -1, 0]);
		const straightUp = applyOps(
			level,
			[{ kind: "rotate", rad: Math.PI / 2, axis: [1, 0, 0] }],
			4,
		);
		const [bx, by, bz] = cameraPos(straightUp);
		const moved = applyOps(
			straightUp,
			[{ kind: "planeMove", forward: 1, right: 0, up: 0 }],
			4,
		);
		const [ax, ay, az] = cameraPos(moved);
		// 兜底：退回相机的"上"轴，总之不能变成原地不动，也不能算出 NaN
		expect(Math.hypot(ax - bx, az - bz)).toBeCloseTo(1, 5);
		expect(ay).toBeCloseTo(by, 5);
	});
});

describe("scaleOps", () => {
	it("按帧时长缩放增量（帧长 2 倍则走 2 倍距离）", () => {
		const ops = keyOps("ArrowUp", false) ?? [];
		expect(scaleOps(ops, 2)[0]).toEqual({
			kind: "translate",
			x: 0,
			y: 0,
			z: STEP.forward * 2,
		});
		const orbit = scaleOps([{ kind: "orbit", yaw: 1, pitch: 0 }], 0.5);
		expect(orbit[0]).toEqual({ kind: "orbit", yaw: 0.5, pitch: 0 });
		const rot = scaleOps([{ kind: "rotate", rad: 1, axis: [0, 1, 0] }], 0.25);
		expect(rot[0]).toEqual({ kind: "rotate", rad: 0.25, axis: [0, 1, 0] });
		// 水平锁定模式的平面移动同样要缩放（前 / 右 / 上 三个分量一起）
		expect(
			scaleOps([{ kind: "planeMove", forward: 2, right: -1, up: 1 }], 0.5),
		).toEqual([{ kind: "planeMove", forward: 1, right: -0.5, up: 0.5 }]);
	});
});

describe("dragOps", () => {
	const base = {
		ctrlKey: false,
		metaKey: false,
		width: 1000,
		height: 500,
	};

	it("左键拖拽 = 环绕，位移按画布尺寸归一化", () => {
		expect(
			norm(dragOps({ ...base, button: 1, deltaX: 100, deltaY: -50 })),
		).toEqual([{ kind: "orbit", yaw: 0.5, pitch: 0.5 }]);
	});

	it("右键（或按住 Ctrl/Cmd）拖拽 = 前后 + 平移", () => {
		expect(
			norm(dragOps({ ...base, button: 2, deltaX: 0, deltaY: 50 })),
		).toEqual([{ kind: "translate", x: 0, y: 0, z: 1 }]);
		expect(
			dragOps({ ...base, button: 1, ctrlKey: true, deltaX: 100, deltaY: 0 }),
		).toEqual([{ kind: "translate", x: -1, y: 0, z: 0 }]);
	});
});

describe("wheelOps", () => {
	const base = {
		deltaMode: 0,
		shiftKey: false,
		ctrlKey: false,
		metaKey: false,
		width: 1000,
		height: 500,
	};

	it("裸滚 = 环绕（参考实现如此，不是缩放）", () => {
		expect(norm(wheelOps({ ...base, deltaX: 100, deltaY: 50 }))).toEqual([
			{ kind: "orbit", yaw: -0.1, pitch: 0.1 },
		]);
	});

	it("Shift + 滚 = 上下左右平移", () => {
		expect(
			norm(wheelOps({ ...base, shiftKey: true, deltaX: 100, deltaY: 50 })),
		).toEqual([{ kind: "translate", x: 0.1, y: 0.1, z: 0 }]);
	});

	it("Ctrl/Cmd + 滚 = 前后移动", () => {
		expect(wheelOps({ ...base, ctrlKey: true, deltaX: 0, deltaY: 50 })).toEqual(
			[{ kind: "translate", x: 0, y: 0, z: -1 }],
		);
	});

	it("行/页单位的滚轮换算成像素", () => {
		const line = wheelOps({ ...base, deltaMode: 1, deltaX: 0, deltaY: 1 });
		// 1 行 = 10 像素 → 10/500 的环绕俯仰
		expect(line[0]).toEqual({ kind: "orbit", yaw: -0, pitch: 0.02 });
		const page = wheelOps({
			...base,
			deltaMode: 2,
			shiftKey: true,
			deltaY: 1,
			deltaX: 0,
		});
		// 1 页 = 一个视口高 → 平移整整一份
		expect(page[0]).toEqual({ kind: "translate", x: 0, y: 1, z: 0 });
	});
});
