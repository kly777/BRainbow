// ── 测试用的 PLY 造件（供 ply.test.ts / splat engine.test.ts 共用） ──
//
// 真实 3DGS 的 .ply 一行有 45 个球谐高阶项，仓里没有现成样本；这里按 PLY 规范
// 现造二进制文件，让解析与渲染链路的测试不依赖外部文件。

export type PlyType = "float" | "double" | "int" | "uint" | "uchar" | "short";

const SIZES: Record<PlyType, number> = {
	float: 4,
	double: 8,
	int: 4,
	uint: 4,
	uchar: 1,
	short: 2,
};

/** 由属性表与数据行拼一个二进制 PLY（默认小端） */
export function buildPly(
	props: Array<[PlyType, string]>,
	rows: number[][],
	format = "binary_little_endian",
	extraElements: string[] = [],
): Uint8Array {
	const le = format === "binary_little_endian";
	const rowSize = props.reduce((sum, [t]) => sum + SIZES[t], 0);
	const header =
		[
			"ply",
			`format ${format} 1.0`,
			"comment 测试",
			`element vertex ${rows.length}`,
			...props.map(([t, n]) => `property ${t} ${n}`),
			...extraElements,
			"end_header",
		].join("\n") + "\n";

	const out = new Uint8Array(header.length + rows.length * rowSize);
	for (let i = 0; i < header.length; i++) out[i] = header.charCodeAt(i);
	const view = new DataView(out.buffer);
	let at = header.length;
	for (const row of rows) {
		props.forEach(([type], idx) => {
			const v = row[idx] ?? 0;
			switch (type) {
				case "float":
					view.setFloat32(at, v, le);
					break;
				case "double":
					view.setFloat64(at, v, le);
					break;
				case "int":
					view.setInt32(at, v, le);
					break;
				case "uint":
					view.setUint32(at, v, le);
					break;
				case "uchar":
					view.setUint8(at, v);
					break;
				case "short":
					view.setInt16(at, v, le);
					break;
			}
			at += SIZES[type];
		});
	}
	return out;
}

/** 3DGS 顶点：x y z + f_dc_0..2 + opacity + scale_0..2 + rot_0..3 */
export const GAUSSIAN_PROPS: Array<[PlyType, string]> = [
	["float", "x"],
	["float", "y"],
	["float", "z"],
	["float", "f_dc_0"],
	["float", "f_dc_1"],
	["float", "f_dc_2"],
	["float", "opacity"],
	["float", "scale_0"],
	["float", "scale_1"],
	["float", "scale_2"],
	["float", "rot_0"],
	["float", "rot_1"],
	["float", "rot_2"],
	["float", "rot_3"],
];

/** 普通点云顶点：位置 + RGB */
export const POINT_PROPS: Array<[PlyType, string]> = [
	["float", "x"],
	["float", "y"],
	["float", "z"],
	["uchar", "red"],
	["uchar", "green"],
	["uchar", "blue"],
];

/** 一行 3DGS 数据；scale 传"取 exp 之前"的值，便于断言 */
export function gaussianRow(
	over: Partial<{
		x: number;
		y: number;
		z: number;
		dc: [number, number, number];
		opacity: number;
		scale: [number, number, number];
		rot: [number, number, number, number];
	}> = {},
): number[] {
	const { x = 0, y = 0, z = 0, dc = [0, 0, 0], opacity = 0 } = over;
	const scale = over.scale ?? [0, 0, 0];
	const rot = over.rot ?? [1, 0, 0, 0];
	return [...[x, y, z], ...dc, opacity, ...scale, ...rot];
}

/** 紧凑数组里的 f32 读取（断言用） */
export const readF32 = (bytes: Uint8Array, offset: number) =>
	new DataView(bytes.buffer, bytes.byteOffset).getFloat32(offset, true);
