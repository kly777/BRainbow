// ── 点云解析（纯函数直测） ──
//
// 覆盖三种输入：PCD（ascii / binary / 不支持的压缩编码）、文本点云（XYZ / PTS）、
// 以及"按内容认格式"的三个判据。输出要能被引擎直接当"普通点云"渲染：
// 小圆点（缩放 0.01）、单位四元数、颜色直取。

import { describe, expect, it } from "vitest";
import { PlyError, SPLAT_ROW_BYTES } from "./ply.ts";
import {
	isPcdBytes,
	isPointCloudName,
	looksLikeTextPoints,
	parsePcd,
	parseTextPoints,
} from "./pointcloud.ts";

/** 紧凑数组里的 f32 (x,y,z) */
const xyzAt = (bytes: Uint8Array, i: number) => {
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	return [
		view.getFloat32(i * SPLAT_ROW_BYTES, true),
		view.getFloat32(i * SPLAT_ROW_BYTES + 4, true),
		view.getFloat32(i * SPLAT_ROW_BYTES + 8, true),
	];
};

/** 紧凑数组里的 rgba 字节 */
const rgbaAt = (bytes: Uint8Array, i: number) => [
	...bytes.slice(i * SPLAT_ROW_BYTES + 24, i * SPLAT_ROW_BYTES + 28),
];

const encode = (text: string) => new TextEncoder().encode(text);

const PCD_HEAD = (extra = "") =>
	`# .PCD v0.7 - Point Cloud Data file format
VERSION 0.7
FIELDS x y z rgb
SIZE 4 4 4 4
TYPE F F F U
COUNT 1 1 1 1
WIDTH 2
HEIGHT 1
VIEWPOINT 0 0 0 1 0 0 0
POINTS 2
DATA ascii
${extra}`;

describe("isPointCloudName / 判据", () => {
	it("按扩展名认领 .pcd/.xyz/.pts（大小写与空白容忍）", () => {
		expect(isPointCloudName("a.pcd")).toBe(true);
		expect(isPointCloudName("SCAN.XYZ")).toBe(true);
		expect(isPointCloudName("  p.pts ")).toBe(true);
		// .las 故意不认（另需一套解析器，且这里没有真实样本可校验）
		expect(isPointCloudName("a.las")).toBe(false);
		expect(isPointCloudName("a.ply")).toBe(false);
		expect(isPointCloudName("a.txt")).toBe(false);
	});

	it("isPcdBytes 认 PCD 头，且不与 PLY / .splat 混淆", () => {
		expect(isPcdBytes(encode(PCD_HEAD()))).toBe(true);
		expect(isPcdBytes(encode("FIELDS x y z\nDATA ascii\n"))).toBe(true);
		expect(isPcdBytes(encode("ply\nformat binary_little_endian 1.0\n"))).toBe(
			false,
		);
		expect(isPcdBytes(new Uint8Array(32))).toBe(false);
	});

	it("looksLikeTextPoints 只认「整行都是数字」，二进制内容一律排除", () => {
		expect(looksLikeTextPoints(encode("1 2 3\n4 5 6\n"))).toBe(true);
		expect(looksLikeTextPoints(encode("2\n1 2 3\n"))).toBe(true); // PTS 首行点数
		expect(looksLikeTextPoints(encode("hello world\n"))).toBe(false);
		expect(looksLikeTextPoints(encode("# 注释\n1 2 3\n"))).toBe(false);
		// 含 NUL 的二进制（.splat 那种）不能当成文本点云
		expect(looksLikeTextPoints(new Uint8Array(64))).toBe(false);
	});
});

describe("parsePcd：ascii", () => {
	it("读出坐标与打包的 rgb（低 24 位）", () => {
		// 0x00FF8040 → r=0xFF g=0x80 b=0x40
		const data = parsePcd(encode(PCD_HEAD("1 2 3 16744512\n-4 5.5 6 255\n")));
		expect(data.vertexCount).toBe(2);
		expect(data.pointCloud).toBe(true);
		expect(xyzAt(data.bytes, 0)).toEqual([1, 2, 3]);
		expect(xyzAt(data.bytes, 1)).toEqual([-4, 5.5, 6]);
		expect(rgbaAt(data.bytes, 0)).toEqual([255, 128, 64, 255]);
		expect(rgbaAt(data.bytes, 1)).toEqual([0, 0, 255, 255]);
		// 点云的固定小尺度 + 单位四元数
		const view = new DataView(data.bytes.buffer, data.bytes.byteOffset);
		expect(view.getFloat32(12, true)).toBeCloseTo(0.01, 6);
		expect([...data.bytes.slice(28, 32)]).toEqual([255, 128, 128, 128]);
	});

	it("r/g/b 三列时按值域归一（0..255 与 0..1 都认）", () => {
		const head = PCD_HEAD()
			.replace("FIELDS x y z rgb", "FIELDS x y z r g b")
			.replace("SIZE 4 4 4 4", "SIZE 4 4 4 1 1 1")
			.replace("TYPE F F F U", "TYPE F F F U U U")
			.replace("COUNT 1 1 1 1", "COUNT 1 1 1 1 1 1");
		const data = parsePcd(encode(`${head}1 2 3 255 128 64\n`));
		expect(rgbaAt(data.bytes, 0)).toEqual([255, 128, 64, 255]);
		const unit = parsePcd(encode(`${head}1 2 3 1 0.5 0\n`));
		expect(rgbaAt(unit.bytes, 0)).toEqual([255, 128, 0, 255]);
	});

	it("缺字段 / 空点集 / 压缩编码都给可读错误", () => {
		// 头部完整但缺 x/y/z 字段
		expect(() =>
			parsePcd(
				encode(
					"FIELDS r g b\nSIZE 4 4 4\nTYPE F F F\nPOINTS 1\nDATA ascii\n1 2 3\n",
				),
			),
		).toThrow(/x\/y\/z/);
		// 头部本身就缺项
		expect(() => parsePcd(encode("FIELDS x y\nDATA ascii\n1 2\n"))).toThrow(
			/FIELDS\/SIZE\/TYPE/,
		);
		expect(() => parsePcd(encode(PCD_HEAD("")))).toThrow(/没有可用的点/);
		expect(() =>
			parsePcd(
				encode(PCD_HEAD().replace("DATA ascii", "DATA binary_compressed")),
			),
		).toThrow(/binary_compressed/);
		expect(() => parsePcd(encode("hello"))).toThrow(PlyError);
	});
});

describe("parsePcd：binary", () => {
	it("按 FIELDS/SIZE/TYPE 的偏移读（含 xyz 之间的其它字段）", () => {
		const header = `# .PCD v0.7
FIELDS x intensity y z
SIZE 4 4 4 4
TYPE F F F F
COUNT 1 1 1 1
POINTS 1
DATA binary
`;
		const bytes = new Uint8Array(header.length + 16);
		bytes.set(encode(header));
		const view = new DataView(bytes.buffer);
		view.setFloat32(header.length, 1.5, true); // x
		view.setFloat32(header.length + 4, 0.25, true); // intensity（跳过）
		view.setFloat32(header.length + 8, -2.5, true); // y
		view.setFloat32(header.length + 12, 7, true); // z

		const data = parsePcd(bytes);
		expect(data.vertexCount).toBe(1);
		expect(xyzAt(data.bytes, 0)).toEqual([1.5, -2.5, 7]);
	});
});

describe("parseTextPoints", () => {
	it("XYZ：至少三个数，可选 rgb", () => {
		const data = parseTextPoints(encode("1 2 3\n4 5 6 255 0 0\n"), "点云文件");
		expect(data.vertexCount).toBe(2);
		expect(xyzAt(data.bytes, 0)).toEqual([1, 2, 3]);
		expect(rgbaAt(data.bytes, 1)).toEqual([255, 0, 0, 255]);
		// 没有颜色的点用中性灰
		expect(rgbaAt(data.bytes, 0)).toEqual([160, 160, 160, 255]);
	});

	it("PTS：首行点数与注释行都跳过", () => {
		const data = parseTextPoints(
			encode("2\n// 注释\n1 1 1\n2 2 2\n"),
			"点云文件",
		);
		expect(data.vertexCount).toBe(2);
		expect(xyzAt(data.bytes, 1)).toEqual([2, 2, 2]);
	});

	it("坏行跳过；一行可用点都没有时给可读错误", () => {
		const data = parseTextPoints(
			encode("坏行\n1 2 3\n又是一行坏数据\n"),
			"点云文件",
		);
		expect(data.vertexCount).toBe(1);
		expect(() =>
			parseTextPoints(encode("全是字\n没有点\n"), "点云文件"),
		).toThrow(/没有可用的点/);
	});
});
