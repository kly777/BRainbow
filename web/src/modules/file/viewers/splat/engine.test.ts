// ── 泼溅引擎：解析 → 纹理打包 → 深度排序的端到端测试 ──
//
// worker 只是这层的通信适配器，所以这里能覆盖"给一份 3DGS 的 .ply，渲染前
// 该拿到什么"：顶点数、包围盒、纹理布局，以及排序顺序确实跟着相机前向轴变。

import { describe, expect, it } from "vitest";
import {
	buildPly,
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

	it("不可解析的内容抛出可读错误（由调用方转成用户提示）", () => {
		const engine = createSplatEngine();
		expect(() => engine.load(new TextEncoder().encode("not a ply"))).toThrow(
			/不是 PLY/,
		);
	});
});

describe("createSplatEngine.sort", () => {
	it("按深度升序：靠近相机的顶点排在前面（先画近的）", () => {
		const engine = createSplatEngine();
		engine.load(buildPly(GAUSSIAN_PROPS, alongZ(4)));
		// 相机在 -z 侧朝 +z 看 → 前向轴 (0,0,1)，z 小的离相机近
		const order = engine.sort([0, 0, 1]);
		expect(order).toBeDefined();
		if (!order) return;
		expect(Array.from(order)).toEqual([0, 1, 2, 3]);
		// 初始顺序也是文件顺序，两者一致时不至于掩盖问题，故换个轴再验
		const reversed = engine.sort([0, 0, -1]);
		expect(reversed && Array.from(reversed)).toEqual([3, 2, 1, 0]);
	});

	it("返回的索引确实指向顶点纹理里的对应顶点（着色器的 texelFetch 契约）", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(buildPly(GAUSSIAN_PROPS, alongZ(4)));
		const order = engine.sort([0, 0, -1]);
		expect(order).toBeDefined();
		if (!order) return;
		// 位置在纹理里是每顶点两个 texel 中的偶数那个：f32 偏移 = index * 8 + 2（z 分量）
		const texF = new Float32Array(loaded.texdata.buffer);
		expect(texF[order[0] * 8 + 2]).toBeCloseTo(12, 5);
		expect(texF[order[3] * 8 + 2]).toBeCloseTo(0, 5);
	});

	it("视角几乎没变时也要给结果（调用方靠它清 pending，否则管线会冻住）", () => {
		const engine = createSplatEngine();
		engine.load(
			buildPly(
				GAUSSIAN_PROPS,
				[0, 1, 2, 3].map((i) => gaussianRow({ x: i * 4, z: i * 4 })),
			),
		);
		const first = engine.sort([0, 0, 1]);
		expect(first).toBeDefined();
		// 同一视角再请求：不重算，但必须回一个结果 —— 否则调用方的"排序在飞"标记
		// 永远清不掉，之后所有相机移动都不再触发排序（表现为：转到背面还是正面的画面）
		const again = engine.sort([0, 0, 1]);
		expect(again).toBeDefined();
		expect(Array.from(again ?? [])).toEqual(Array.from(first ?? []));
		// 视角真的变了才有新结果
		expect(engine.sort([1, 0, 0])).toBeDefined();
	});

	it("排序与坐标平移无关（UTM 那类大坐标不能排乱）", () => {
		// 旧实现把深度存成 int32（`depth × 4096 | 0`），翻折点在 2^31 / 4096 ≈ 524288；
		// 地理配准点云的 UTM 东坐标正好落在 20 万～80 万这一段，跨过翻折点就会排成乱序
		// （画面表现："严重错乱/变形"）。这条断言只要求"同一场景平移后顺序不变"。
		const rowsAt = (shift: number) =>
			[0, 800, 1600, 2400].map((dz) => gaussianRow({ z: shift + dz }));
		const near = createSplatEngine();
		near.load(buildPly(GAUSSIAN_PROPS, rowsAt(0)));
		const expected = Array.from(near.sort([0, 0, 1]));
		expect(expected).toEqual([0, 1, 2, 3]);

		const far = createSplatEngine();
		far.load(buildPly(GAUSSIAN_PROPS, rowsAt(524_000)));
		expect(Array.from(far.sort([0, 0, 1]))).toEqual(expected);
	});

	it("所有顶点同深度时保持原序（计数排序的分母会退化，必须守住）", () => {
		const engine = createSplatEngine();
		const loaded = engine.load(
			buildPly(GAUSSIAN_PROPS, [
				gaussianRow({ x: 1, y: 2, z: 0 }),
				gaussianRow({ x: 3, y: 4, z: 0 }),
			]),
		);
		// 沿 z 排序时两点深度相同 → 不重排，但仍要回结果（而不是算出 NaN 索引）
		const same = engine.sort([0, 0, 1]);
		expect(same).toBeDefined();
		expect(Array.from(same ?? [])).toEqual(Array.from(loaded.depthIndex));
		// 沿 x 排序时两点深度不同 → 有结果
		expect(engine.sort([1, 0, 0])).toEqual(new Uint32Array([0, 1]));
	});

	it("还没加载数据时排序返回空索引（调用方拿到 0 个顶点，不会画出东西）", () => {
		const empty = createSplatEngine().sort([0, 0, 1]);
		expect(empty.length).toBe(0);
	});
});
