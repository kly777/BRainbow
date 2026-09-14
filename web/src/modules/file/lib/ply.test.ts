// ── PLY 解析（纯函数直测） ──
//
// 用测试里现造的二进制 PLY 覆盖：头部解析、属性偏移（含跳过的未用属性）、
// 3DGS 字段换算（exp 缩放 / sigmoid 不透明度 / f_dc 颜色 / 四元数归一化）、
// importance 排序、点云兜底、字节序、截断与不支持的格式。

import { describe, expect, it } from "vitest";
import {
	buildSplatData,
	buildSplatTexture,
	isPlyName,
	PlyError,
	parsePlyHeader,
	SPLAT_ROW_BYTES,
} from "./ply.ts";
import {
	buildPly,
	GAUSSIAN_PROPS,
	gaussianRow,
	type PlyType,
	POINT_PROPS,
	readF32,
} from "./ply-fixtures.ts";

const SH_C0 = 0.28209479177387814;

describe("isPlyName", () => {
	it("大小写与首尾空白都容忍", () => {
		expect(isPlyName("场景.ply")).toBe(true);
		expect(isPlyName("SCENE.PLY")).toBe(true);
		expect(isPlyName("  a.ply  ")).toBe(true);
	});

	it("其它扩展名不误判（.ply.gz / .splat 不走这个查看器）", () => {
		expect(isPlyName("a.splat")).toBe(false);
		expect(isPlyName("a.ply.gz")).toBe(false);
		expect(isPlyName("ply")).toBe(false);
	});
});

describe("parsePlyHeader", () => {
	it("读出格式、顶点数、行宽与属性偏移", () => {
		const bytes = buildPly(GAUSSIAN_PROPS, [gaussianRow(), gaussianRow()]);
		const h = parsePlyHeader(bytes);
		expect(h.format).toBe("binary_little_endian");
		expect(h.vertexCount).toBe(2);
		expect(h.rowSize).toBe(14 * 4);
		expect(h.fields.get("x")?.offset).toBe(0);
		expect(h.fields.get("opacity")?.offset).toBe(6 * 4);
		expect(h.fields.get("rot_3")?.offset).toBe(13 * 4);
		// 数据起点紧随 end_header 的换行
		expect(
			new TextDecoder().decode(bytes.subarray(h.dataOffset, h.dataOffset + 3)),
		).toBe("\u0000\u0000\u0000");
	});

	it("未使用的属性照样参与行宽计算（跳过 f_rest_* / nx 是关键）", () => {
		const props: Array<[PlyType, string]> = [
			["float", "x"],
			["float", "y"],
			["float", "z"],
			["float", "nx"],
			["float", "ny"],
			["float", "nz"],
			["double", "f_rest_0"],
			["uchar", "red"],
		];
		const h = parsePlyHeader(buildPly(props, [[1, 2, 3, 0, 0, 0, 0, 255]]));
		expect(h.rowSize).toBe(3 * 4 + 3 * 4 + 8 + 1);
		expect(h.fields.get("red")?.offset).toBe(3 * 4 + 3 * 4 + 8);
		expect(h.fields.get("f_rest_0")?.kind).toBe("float64");
	});

	it("element face 的属性不影响顶点行宽", () => {
		const bytes = buildPly(
			GAUSSIAN_PROPS,
			[gaussianRow()],
			"binary_little_endian",
			["element face 1", "property list uchar int vertex_indices"],
		);
		expect(parsePlyHeader(bytes).rowSize).toBe(14 * 4);
	});

	it("拒绝非 PLY 与不完整头部", () => {
		expect(() => parsePlyHeader(new TextEncoder().encode("hello"))).toThrow(
			PlyError,
		);
		expect(() =>
			parsePlyHeader(new TextEncoder().encode("ply\nformat ascii 1.0\n")),
		).toThrow(/end_header/);
	});

	it("未知属性类型给出可读错误", () => {
		const text =
			"ply\nformat binary_little_endian 1.0\nelement vertex 1\nproperty quad x\nend_header\n";
		expect(() => parsePlyHeader(new TextEncoder().encode(text))).toThrow(
			/未知的属性类型/,
		);
	});
});

describe("buildSplatData：3DGS", () => {
	it("scale 取 exp、opacity 过 sigmoid、f_dc 转基色、四元数归一化", () => {
		const bytes = buildPly(GAUSSIAN_PROPS, [
			gaussianRow({
				x: 1.5,
				y: -2,
				z: 3,
				dc: [1, 0, -1],
				opacity: 0,
				scale: [0, Math.LN2, Math.log(3)],
				rot: [2, 0, 0, 0],
			}),
		]);
		const data = buildSplatData(bytes);
		expect(data.pointCloud).toBe(false);
		expect(data.vertexCount).toBe(1);

		expect(readF32(data.bytes, 0)).toBeCloseTo(1.5, 5);
		expect(readF32(data.bytes, 4)).toBeCloseTo(-2, 5);
		expect(readF32(data.bytes, 8)).toBeCloseTo(3, 5);
		// exp([0, ln2, ln3]) = [1, 2, 3]
		expect(readF32(data.bytes, 12)).toBeCloseTo(1, 5);
		expect(readF32(data.bytes, 16)).toBeCloseTo(2, 5);
		expect(readF32(data.bytes, 20)).toBeCloseTo(3, 5);
		// f_dc: 0.5 + SH_C0 * dc
		expect(data.bytes[24]).toBe(Math.round((0.5 + SH_C0) * 255));
		expect(data.bytes[25]).toBe(Math.round(0.5 * 255));
		expect(data.bytes[26]).toBe(Math.round((0.5 - SH_C0) * 255));
		// opacity=0 → sigmoid=0.5
		expect(data.bytes[27]).toBe(Math.round(0.5 * 255));
		// 四元数 (2,0,0,0) 归一化 → (1,0,0,0) → 255,128,128,128
		expect(data.bytes[28]).toBe(255);
		expect(data.bytes[29]).toBe(128);
		expect(data.bytes[30]).toBe(128);
		expect(data.bytes[31]).toBe(128);
	});

	it("f_dc 很负时颜色截断到 0，而不是回绕成亮色", () => {
		const bytes = buildPly(GAUSSIAN_PROPS, [
			gaussianRow({ dc: [-10, -10, -10], opacity: -100 }),
		]);
		const data = buildSplatData(bytes);
		expect(data.bytes[24]).toBe(0);
		expect(data.bytes[26]).toBe(0);
		expect(data.bytes[27]).toBe(0);
	});

	it("按 importance（体积 × 不透明度）降序排列", () => {
		// 三行缩放到 exp(ln1)=1、exp(ln100)=100、exp(ln2)=2，opacity 都取 0（0.5）
		const bytes = buildPly(GAUSSIAN_PROPS, [
			gaussianRow({ x: 1, scale: [Math.log(1), 0, 0] }),
			gaussianRow({ x: 2, scale: [Math.log(100), 0, 0] }),
			gaussianRow({ x: 3, scale: [Math.log(2), 0, 0] }),
		]);
		const data = buildSplatData(bytes);
		// 排在最前的是体积最大的那个（原第 2 行，x=2）
		expect(readF32(data.bytes, 0)).toBeCloseTo(2, 5);
		expect(readF32(data.bytes, SPLAT_ROW_BYTES)).toBeCloseTo(3, 5);
		expect(readF32(data.bytes, SPLAT_ROW_BYTES * 2)).toBeCloseTo(1, 5);
	});

	it("算出的包围盒用于自动取景", () => {
		// 三个点沿对角线对称分布：中位数明确（两点时"中位数"只能取其中之一）
		const bytes = buildPly(GAUSSIAN_PROPS, [
			gaussianRow({ x: -1, y: -1, z: -1 }),
			gaussianRow({ x: 0, y: 0, z: 0 }),
			gaussianRow({ x: 1, y: 1, z: 1 }),
		]);
		const { bounds } = buildSplatData(bytes);
		// 中位数由直方图给出，允许一个桶宽（取值范围 / 1024）的误差
		expect(bounds.center[0]).toBeCloseTo(0, 2);
		expect(bounds.center[1]).toBeCloseTo(0, 2);
		expect(bounds.center[2]).toBeCloseTo(0, 2);
		// 两点都在对角线两端 → 取景半径（P90）与包围盒半径一致
		expect(bounds.bboxRadius).toBeCloseTo(Math.sqrt(12) / 2, 5);
		expect(bounds.radius).toBeCloseTo(bounds.bboxRadius, 1);
	});

	it("取景半径用距离的 P90：少数离群高斯不把相机推远", () => {
		// 100 个点挤在半径 1 内 + 1 个离群点跑到 1000 外
		const rows = Array.from({ length: 100 }, (_, i) =>
			gaussianRow({
				x: Math.cos(i) * 0.5,
				y: Math.sin(i) * 0.5,
				z: (i % 7) / 7,
			}),
		);
		rows.push(gaussianRow({ x: 1000, y: 0, z: 0 }));
		const { bounds } = buildSplatData(buildPly(GAUSSIAN_PROPS, rows));

		// 包围盒被离群点撑到 500 左右
		expect(bounds.bboxRadius).toBeGreaterThan(400);
		// 取景半径仍在内容尺度上（约 0.5），而不是被离群点带到 500 —— 它才是相机距离的输入
		expect(bounds.radius).toBeLessThan(2);
		expect(bounds.radius).toBeGreaterThan(0.1);
	});

	it("支持大端序文件", () => {
		const bytes = buildPly(
			GAUSSIAN_PROPS,
			[gaussianRow({ x: 7, y: 8, z: 9 })],
			"binary_big_endian",
		);
		const data = buildSplatData(bytes);
		expect(readF32(data.bytes, 0)).toBeCloseTo(7, 5);
		expect(readF32(data.bytes, 4)).toBeCloseTo(8, 5);
		expect(readF32(data.bytes, 8)).toBeCloseTo(9, 5);
	});
});

describe("buildSplatData：点云与异常", () => {
	it("没有高斯参数时按小圆点处理（尺度 0.01、单位四元数、颜色直取）", () => {
		const data = buildSplatData(buildPly(POINT_PROPS, [[1, 2, 3, 10, 20, 30]]));
		expect(data.pointCloud).toBe(true);
		expect(readF32(data.bytes, 12)).toBeCloseTo(0.01, 6);
		expect(data.bytes[24]).toBe(10);
		expect(data.bytes[25]).toBe(20);
		expect(data.bytes[26]).toBe(30);
		expect(data.bytes[27]).toBe(255);
		// 参考实现同此：(255,0,0,0) 即近似单位四元数
		expect(data.bytes[28]).toBe(255);
		expect(data.bytes[29]).toBe(0);
	});

	it("点云保持文件顺序（没有 importance 可排）", () => {
		const data = buildSplatData(
			buildPly(POINT_PROPS, [
				[1, 0, 0, 0, 0, 0],
				[2, 0, 0, 0, 0, 0],
			]),
		);
		expect(readF32(data.bytes, 0)).toBeCloseTo(1, 5);
		expect(readF32(data.bytes, SPLAT_ROW_BYTES)).toBeCloseTo(2, 5);
	});

	it("ASCII 格式给出明确提示而不是崩", () => {
		expect(() =>
			buildSplatData(buildPly(POINT_PROPS, [[0, 0, 0, 0, 0, 0]], "ascii")),
		).toThrow(/ASCII/);
	});

	it("缺位置属性 / 无颜色无高斯参数 / 数据被截断都抛出可读错误", () => {
		expect(() =>
			buildSplatData(
				buildPly(
					[
						["float", "x"],
						["float", "y"],
					],
					[[1, 2]],
				),
			),
		).toThrow(/缺少 z/);

		expect(() =>
			buildSplatData(
				buildPly(
					[
						["float", "x"],
						["float", "y"],
						["float", "z"],
					],
					[[1, 2, 3]],
				),
			),
		).toThrow(/既没有高斯参数/);

		// 头部完整、数据被截断
		const full = buildPly(POINT_PROPS, [[1, 2, 3, 0, 0, 0]]);
		const truncated = full.subarray(0, parsePlyHeader(full).dataOffset + 4);
		expect(() => buildSplatData(truncated)).toThrow(/数据不完整/);
	});

	it("没有顶点时抛错", () => {
		expect(() => buildSplatData(buildPly(POINT_PROPS, []))).toThrow(/没有顶点/);
	});
});

describe("buildSplatTexture", () => {
	it("每顶点两个 texel，位置在偶数 texel、颜色塞在奇数 texel 的第四个分量", () => {
		const data = buildSplatData(
			buildPly(GAUSSIAN_PROPS, [
				gaussianRow({ x: 4, y: 5, z: 6, dc: [0, 0, 0] }),
			]),
		);
		const { texdata, texHeight } = buildSplatTexture(data, 8);
		// 1 个顶点 → 2 个 texel → 宽 8 时占 1 行
		expect(texHeight).toBe(1);
		expect(texdata.length).toBe(8 * 1 * 4);

		const f = new Float32Array(texdata.buffer);
		expect(f[0]).toBeCloseTo(4, 5);
		expect(f[1]).toBeCloseTo(5, 5);
		expect(f[2]).toBeCloseTo(6, 5);

		const u = new Uint8Array(texdata.buffer);
		// 第二个 texel = 索引 7；它的第 4 个 u32 分量承载 rgba
		expect(u[4 * 7 + 0]).toBe(data.bytes[24]);
		expect(u[4 * 7 + 3]).toBe(data.bytes[27]);
	});

	it("顶点多时行数按 2 倍顶点数向上取整", () => {
		const rows = Array.from({ length: 5 }, (_, i) => gaussianRow({ x: i }));
		const data = buildSplatData(buildPly(GAUSSIAN_PROPS, rows));
		// 10 个 texel ÷ 宽 4 = 3 行（向上取整）
		expect(buildSplatTexture(data, 4).texHeight).toBe(3);
	});
});
