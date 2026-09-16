// ── 泼溅引擎：解析 → 纹理打包 → 深度排序的端到端测试 ──
//
// worker 只是这层的通信适配器，所以这里能覆盖"给一份 3DGS 的 .ply，渲染前
// 该拿到什么"：顶点数、包围盒、纹理布局，以及排序顺序确实跟着相机前向轴变。

import { describe, expect, it } from "vitest";
import {
	buildPly,
	buildSplat,
	GAUSSIAN_PROPS,
	gaussianRow,
	POINT_PROPS,
} from "../../lib/ply-fixtures.ts";
import { createSplatEngine, TEX_WIDTH } from "./engine.ts";

/** 沿 z 轴排开的一串高斯（每 4 个单位一个），用于验证深度排序 */
const alongZ = (count: number) =>
	Array.from({ length: count }, (_, i) =>
		gaussianRow({ z: i * 4, scale: [0, 0, 0] }),
	);

/**
 * 断言"这次确实重排了"并取出顺序。
 *
 * 排序有两种合法结果：新顺序，或 `undefined`（= 视角几乎没变，复用上一次的顺序）。
 * 直接 `Array.from(sort(...))` 会把两者混在一起，这里分清楚。
 */
function sorted(order: Uint32Array | undefined): number[] {
	if (!order) throw new Error("预期这次会重排，但引擎返回了 undefined");
	return Array.from(order);
}

describe("createSplatEngine.load", () => {
	it("给出顶点数、取景中心与半径、纹理尺寸", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(buildPly(GAUSSIAN_PROPS, alongZ(5)));

		expect(loaded.vertexCount).toBe(5);
		expect(engine.vertexCount).toBe(5);
		expect(loaded.pointCloud).toBe(false);
		expect(loaded.texWidth).toBe(TEX_WIDTH);
		// 每顶点 2 个 texel → 10 个 texel 只占一行
		expect(loaded.texHeight).toBe(1);
		expect(loaded.texdata.length).toBe(TEX_WIDTH * loaded.texHeight * 4);
		// z 从 0 到 16 → 鲁棒包围盒中心 8、半宽 8（1%/99% 分位；5 个点也取得到两端）。
		// 分位由直方图给出，允许一个桶宽的误差（取值范围 / 1024）
		expect(loaded.bounds.center[2]).toBeCloseTo(8, 1);
		expect(loaded.bounds.half[2]).toBeCloseTo(8, 1);
		expect(loaded.bounds.bboxRadius).toBeCloseTo(8, 5);
	});

	it("普通点云标记出来（UI 要提示）", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(
			buildPly(POINT_PROPS, [
				[0, 0, 0, 1, 2, 3],
				[1, 0, 0, 4, 5, 6],
			]),
		);
		expect(loaded.pointCloud).toBe(true);
		expect(loaded.vertexCount).toBe(2);
	});

	it("按内容分辨格式：PCD 与文本点云也认（都走普通点云渲染路径）", () => {
		const engine = createSplatEngine();
		const pcd = new TextEncoder().encode(
			"# .PCD v0.7\nFIELDS x y z\nSIZE 4 4 4\nTYPE F F F\nPOINTS 2\nDATA ascii\n0 0 0\n4 0 0\n",
		);
		const loaded = engine.load(pcd);
		expect(loaded.vertexCount).toBe(2);
		// 没有高斯参数 → 引擎按小圆点渲染，UI 提示也据此区分
		expect(loaded.pointCloud).toBe(true);
		expect(loaded.bounds.center[0]).toBeCloseTo(2, 1);

		const xyz = engine.load(new TextEncoder().encode("1 2 3\n4 5 6\n"));
		expect(xyz.vertexCount).toBe(2);
		expect(xyz.pointCloud).toBe(true);
	});

	it("按内容分辨格式：没有 PLY 魔数就按 .splat 读", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(
			buildSplat([{ pos: [0, 0, 0] }, { pos: [4, 0, 0] }, { pos: [0, 0, 8] }]),
		);
		expect(loaded.vertexCount).toBe(3);
		expect(engine.vertexCount).toBe(3);
		// .splat 必带高斯参数，没有"普通点云"那种情况
		expect(loaded.pointCloud).toBe(false);
		expect(loaded.texWidth).toBe(TEX_WIDTH);
		expect(loaded.bounds.center[2]).toBeCloseTo(4, 1);
		// 排序照样能跑（索引指向纹理里的对应顶点）
		const order = engine.sort([0, 0, 1]);
		expect(order && Array.from(order)).toEqual([0, 1, 2]);
	});

	it("不可解析的内容抛出可读错误（由调用方转成用户提示）", () => {
		const engine = createSplatEngine();
		// 既没有 PLY 魔数，长度也不是 32 的整数倍（.splat 的定长）→ 两种格式都排除
		expect(() => engine.load(new Uint8Array(100).fill(7))).toThrow(
			/不是 PLY，也不是 \.splat/,
		);
	});
});

describe("createSplatEngine.sort", () => {
	it("按深度升序：靠近相机的顶点排在前面（先画近的）", () => {
		const engine = createSplatEngine();
		engine.load(buildPly(GAUSSIAN_PROPS, alongZ(4)));
		// 相机在 -z 侧朝 +z 看 → 前向轴 (0,0,1)，z 小的离相机近
		expect(sorted(engine.sort([0, 0, 1]))).toEqual([0, 1, 2, 3]);
		// 初始顺序也是文件顺序，两者一致时不至于掩盖问题，故换个轴再验
		expect(sorted(engine.sort([0, 0, -1]))).toEqual([3, 2, 1, 0]);
	});

	it("返回的索引确实指向顶点纹理里的对应顶点（着色器的 texelFetch 契约）", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(buildPly(GAUSSIAN_PROPS, alongZ(4)));
		const order = sorted(engine.sort([0, 0, -1]));
		// 位置在纹理里是每顶点两个 texel 中的偶数那个：f32 偏移 = index * 8 + 2（z 分量）
		const texF = new Float32Array(loaded.texdata.buffer);
		expect(texF[order[0] * 8 + 2]).toBeCloseTo(12, 5);
		expect(texF[order[3] * 8 + 2]).toBeCloseTo(0, 5);
	});

	it("视角几乎没变时返回 undefined（不重算，也不必把索引再搬一遍）", () => {
		const engine = createSplatEngine();
		engine.load(
			buildPly(
				GAUSSIAN_PROPS,
				[0, 1, 2, 3].map((i) => gaussianRow({ x: i * 4, z: i * 4 })),
			),
		);
		expect(sorted(engine.sort([0, 0, 1]))).toEqual([0, 1, 2, 3]);
		// 同一视角再请求：不重算 → undefined。调用方据此跳过索引的上传与重绘
		// （那份索引几十万项，来回搬是拖拽时最大的开销）。
		// 注意"必须有答复"这件事由 worker/runner 保证：它们见到 undefined 会回一条
		// sort-skipped，主线程的"排序在飞"标记照旧能清掉（见 runner.test.ts）
		expect(engine.sort([0, 0, 1])).toBeUndefined();
		// 视角真的变了才有新结果
		expect(sorted(engine.sort([1, 0, 0])).length).toBe(4);
	});

	it("重排阈值与参考实现同一量级（约 8°，不是 2.6°）", () => {
		const engine = createSplatEngine();
		engine.load(buildPly(GAUSSIAN_PROPS, alongZ(4)));
		expect(sorted(engine.sort([0, 0, 1]))).toEqual([0, 1, 2, 3]);
		/** 前向轴在 xz 平面内转过 deg 度 */
		const turned = (deg: number): [number, number, number] => {
			const rad = (deg * Math.PI) / 180;
			return [Math.sin(rad), 0, Math.cos(rad)];
		};
		// 5° 在阈值内 → 复用（旧实现用 0.001 ≈ 2.6°，这一步会真的重排几十万顶点）
		expect(engine.sort(turned(5))).toBeUndefined();
		// 10° 超阈值（0.01 → 约 8.1°）→ 真的重排
		expect(engine.sort(turned(10))).toBeDefined();
	});

	it("排序与坐标平移无关（UTM 那类大坐标不能排乱）", () => {
		// 旧实现把深度存成 int32（`depth × 4096 | 0`），翻折点在 2^31 / 4096 ≈ 524288；
		// 地理配准点云的 UTM 东坐标正好落在 20 万～80 万这一段，跨过翻折点就会排成乱序
		// （画面表现："严重错乱/变形"）。这条断言只要求"同一场景平移后顺序不变"。
		const rowsAt = (shift: number) =>
			[0, 800, 1600, 2400].map((dz) => gaussianRow({ z: shift + dz }));
		const near = createSplatEngine();
		near.load(buildPly(GAUSSIAN_PROPS, rowsAt(0)));
		const expected = sorted(near.sort([0, 0, 1]));
		expect(expected).toEqual([0, 1, 2, 3]);

		const far = createSplatEngine();
		far.load(buildPly(GAUSSIAN_PROPS, rowsAt(524_000)));
		expect(sorted(far.sort([0, 0, 1]))).toEqual(expected);
	});

	it("所有顶点同深度时保持原序（计数排序的分母会退化，必须守住）", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(
			buildPly(GAUSSIAN_PROPS, [
				gaussianRow({ x: 1, y: 2, z: 0 }),
				gaussianRow({ x: 3, y: 4, z: 0 }),
			]),
		);
		// 沿 z 排序时两点深度相同 → 顺序没变（手上那份就是对的），
		// 也不能算出 NaN 索引
		expect(engine.sort([0, 0, 1])).toBeUndefined();
		expect(loaded.depthIndex).toEqual(new Uint32Array([0, 1]));
		// 沿 x 排序时两点深度不同 → 有结果
		expect(sorted(engine.sort([1, 0, 0]))).toEqual([0, 1]);
	});

	it("还没加载数据时排序返回 undefined（没有可回的顺序）", () => {
		expect(createSplatEngine().sort([0, 0, 1])).toBeUndefined();
	});
});
