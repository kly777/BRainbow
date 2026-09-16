// ── 点云解析（PCD / XYZ / PTS） ──
//
// 输出与 ply.ts 同一份紧凑数组（每顶点 32 字节），走"没有高斯参数"那条渲染分支：
// 缩放取 0.01、旋转取单位四元数、颜色直取 RGB —— 引擎里本来就有这条普通点云路径
// （原本给没有 scale_0 的 .ply 用），这里只是多认几种输入格式。
//
// 判据一律看**内容**（与 .splat 同一套做法）：PCD 有 ASCII 头、文本点云是"整行都是
// 数字"。这样改了扩展名也照样能看；反过来，命名成 .pcd 的别的东西会在这里拿到
// 一句可读的报错，而不是画出一堆垃圾。
//
// 上限：文本点云按行解析很慢，超过 MAX_TEXT_POINTS 截断（预览够用，完整数据交给本地工具）。

import {
	boundsFromPositions,
	fitSample,
	PlyError,
	SPLAT_ROW_BYTES,
	type SplatData,
} from "./ply.ts";

/** 文本点云最多解析多少个点（超出截断） */
export const MAX_TEXT_POINTS = 2_000_000;

/** PCD 的四种 DATA 编码里唯一不支持的一种（LZF 压缩，得另带解压器） */
const PCD_COMPRESSED_HINT =
	"PCD 的 binary_compressed 编码暂不支持（可用 pcl_convert_pcd_ascii_binary 转成 ascii/binary 再看）";

/** 没有颜色信息时用的中性灰（LiDAR 点云多半只有强度/坐标） */
const DEFAULT_COLOR = 160;

/** 取前 n 字节当 ASCII 看（点云的头都是 ASCII；逐字节映射避免多字节解码噪声） */
function asciiHead(bytes: Uint8Array, n: number): string {
	let text = "";
	for (const b of bytes.subarray(0, Math.min(bytes.length, n))) {
		text += String.fromCharCode(b);
	}
	return text;
}

/**
 * 注册表按扩展名认领的点云格式。
 *
 * `.las` / `.laz` 不在内：LAS 的十种点位格式（含压缩的 laz）另需一套解析器，
 * 而这里没有真实样本可校验，宁可让它落到 hex 查看器回答"这是什么文件"，
 * 也不冒险按规范猜字段偏移。`.txt` 也不认 —— 那是文本查看器的地盘。
 */
export function isPointCloudName(name: string): boolean {
	return /\.(pcd|xyz|pts)$/i.test(name.trim());
}

/** 是否是 PCD（头部第一行是 `# .PCD v0.7`，或直接就是 FIELDS 行） */
export function isPcdBytes(bytes: Uint8Array): boolean {
	const head = asciiHead(bytes, 256).toLowerCase();
	return head.includes(".pcd") || head.startsWith("fields ");
}

/** 是否像文本点云（XYZ / PTS）：第一行都是数字，且前若干字节没有 NUL */
export function looksLikeTextPoints(bytes: Uint8Array): boolean {
	const head = asciiHead(bytes, 512);
	if (head.length === 0 || head.includes("\0")) return false;
	const firstLine = (head.split("\n")[0] ?? "").trim();
	if (firstLine === "") return false;
	const parts = firstLine.split(/\s+/);
	// PTS 的第一行是点数（一个整数）
	if (parts.length === 1) return /^\d+$/.test(parts[0] ?? "");
	return parts.slice(0, 3).every((v) => v !== "" && Number.isFinite(Number(v)));
}

/** 累积点与颜色，最后一次性打包 */
class PointSink {
	private readonly positions: number[] = [];
	private readonly colors: number[] = [];

	constructor(private readonly cap: number) {}

	push(x: number, y: number, z: number, r: number, g: number, b: number): void {
		if (this.positions.length / 3 >= this.cap) return;
		this.positions.push(x, y, z);
		this.colors.push(r, g, b);
	}

	/** 打包成引擎用的紧凑数组（小圆点 + 单位四元数），无点时抛可读错误 */
	finish(what: string): SplatData {
		const count = this.positions.length / 3;
		if (count === 0) throw new PlyError(`${what}里没有可用的点`);
		const bytes = new Uint8Array(count * SPLAT_ROW_BYTES);
		const view = new DataView(bytes.buffer);
		const positions32 = new Float32Array(count * 3);
		for (let i = 0; i < count; i++) {
			const x = this.positions[i * 3] ?? 0;
			const y = this.positions[i * 3 + 1] ?? 0;
			const z = this.positions[i * 3 + 2] ?? 0;
			positions32[i * 3] = x;
			positions32[i * 3 + 1] = y;
			positions32[i * 3 + 2] = z;
			const o = i * SPLAT_ROW_BYTES;
			view.setFloat32(o, x, true);
			view.setFloat32(o + 4, y, true);
			view.setFloat32(o + 8, z, true);
			view.setFloat32(o + 12, 0.01, true);
			view.setFloat32(o + 16, 0.01, true);
			view.setFloat32(o + 20, 0.01, true);
			bytes[o + 24] = this.colors[i * 3] ?? DEFAULT_COLOR;
			bytes[o + 25] = this.colors[i * 3 + 1] ?? DEFAULT_COLOR;
			bytes[o + 26] = this.colors[i * 3 + 2] ?? DEFAULT_COLOR;
			bytes[o + 27] = 255;
			// 单位四元数 (1,0,0,0)：着色器按 (u8-128)/128 还原，所以 0 要写成 128
			bytes[o + 28] = 255;
			bytes[o + 29] = 128;
			bytes[o + 30] = 128;
			bytes[o + 31] = 128;
		}
		return {
			bytes,
			vertexCount: count,
			bounds: boundsFromPositions(positions32, count),
			sample: fitSample(positions32, count),
			pointCloud: true,
		};
	}
}

/** 颜色分量归一：`already255` 为真表示值域本来就是 0..255，否则按 0..1 放大 */
function normalizeColor(value: number, already255: boolean): number {
	const scaled = already255 ? value : value * 255;
	if (!Number.isFinite(scaled)) return 0;
	return Math.max(0, Math.min(255, Math.round(scaled)));
}

/** 一行里的颜色（0..255 与 0..1 两种约定都常见，按"有没有分量大于 1"判） */
function colorFrom(rgb: number[]): [number, number, number] {
	const already255 = rgb.some((v) => v > 1);
	return [
		normalizeColor(rgb[0] ?? 0, already255),
		normalizeColor(rgb[1] ?? 0, already255),
		normalizeColor(rgb[2] ?? 0, already255),
	];
}

/** PCD 的一个字段（FIELDS / SIZE / TYPE / COUNT 四行对齐着读） */
interface PcdField {
	name: string;
	size: number;
	type: "F" | "U" | "I";
	offset: number;
}

/** `.pcd`（PCL 的点云格式）→ 紧凑数组。支持 `ascii` 与 `binary`，压缩编码给可读提示 */
export function parsePcd(bytes: Uint8Array): SplatData {
	const head = asciiHead(bytes, 4096);
	const dataLine = /\nDATA\s+(\S+)\s*\r?\n/i.exec(head);
	if (!dataLine) throw new PlyError("PCD 头部不完整（找不到 DATA 行）");
	const encoding = (dataLine[1] ?? "").toLowerCase();
	if (encoding === "binary_compressed") throw new PlyError(PCD_COMPRESSED_HINT);
	const headerEnd = (dataLine.index ?? 0) + dataLine[0].length;

	const headerLines = head.slice(0, dataLine.index).split(/\r?\n/);
	const readList = (key: string): string[] | undefined => {
		// 行先转小写，key 也得跟着转 —— PCD 头部是大写的（FIELDS / SIZE / TYPE）
		const prefix = `${key.toLowerCase()} `;
		const line = headerLines.find((l) =>
			l.trim().toLowerCase().startsWith(prefix),
		);
		return line?.trim().split(/\s+/).slice(1);
	};
	const names = readList("FIELDS") ?? readList("COLUMNS");
	const sizes = (readList("SIZE") ?? readList("SIZES"))?.map(Number);
	const types = readList("TYPE") ?? readList("TYPES");
	const counts = (readList("COUNT") ?? []).map(Number);
	if (!names || !sizes || !types || names.length !== sizes.length)
		throw new PlyError("PCD 头部缺少 FIELDS/SIZE/TYPE（或三者长度不一致）");
	if (counts.some((n) => n > 1))
		throw new PlyError("PCD 的字段带 COUNT > 1（多维字段）暂不支持");

	let offset = 0;
	const layout: PcdField[] = names.map((name, i) => {
		const size = sizes[i] ?? 0;
		const type = (types[i] ?? "").toUpperCase();
		const field: PcdField = {
			name: name.toLowerCase(),
			size,
			type: type === "F" ? "F" : type === "U" ? "U" : "I",
			offset,
		};
		offset += size;
		return field;
	});
	const rowSize = offset;
	const field = (name: string) => layout.find((f) => f.name === name);
	const xField = field("x");
	const yField = field("y");
	const zField = field("z");
	if (!xField || !yField || !zField) throw new PlyError("PCD 缺少 x/y/z 字段");

	const declared = Number(readList("POINTS")?.[0] ?? "");
	const sink = new PointSink(
		Number.isFinite(declared) && declared > 0 ? declared : MAX_TEXT_POINTS,
	);

	if (encoding === "ascii") {
		const body = new TextDecoder().decode(bytes.subarray(headerEnd));
		const packedAt = names.findIndex((n) => n.toLowerCase() === "rgb");
		const channelAt = ["r", "g", "b"].map((n) =>
			names.findIndex((f) => f.toLowerCase() === n),
		);
		for (const line of body.split("\n")) {
			const values = line.trim().split(/\s+/);
			if (values.length < names.length) continue;
			const num = (i: number) => Number(values[i] ?? Number.NaN);
			const x = num(names.findIndex((n) => n.toLowerCase() === "x"));
			const y = num(names.findIndex((n) => n.toLowerCase() === "y"));
			const z = num(names.findIndex((n) => n.toLowerCase() === "z"));
			if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)))
				continue;
			sink.push(x, y, z, ...asciiRowColor(values, packedAt, channelAt));
		}
	} else if (encoding === "binary") {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const count = Math.floor((bytes.length - headerEnd) / rowSize);
		const packed = field("rgb") ?? field("rgba");
		const channel = ["r", "g", "b"].map((n) => field(n));
		for (let i = 0; i < count; i++) {
			const base = headerEnd + i * rowSize;
			const x = readPcdValue(view, base, xField);
			const y = readPcdValue(view, base, yField);
			const z = readPcdValue(view, base, zField);
			if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)))
				continue;
			sink.push(x, y, z, ...binaryRowColor(view, base, packed, channel));
		}
	} else {
		throw new PlyError(`PCD 的 DATA 编码不认识：${encoding}`);
	}

	return sink.finish("PCD");
}

/** ASCII 行的颜色：rgb 打包列 → 位拆；r/g/b 三列 → 按值域归一 */
function asciiRowColor(
	values: string[],
	packedAt: number,
	channelAt: number[],
): [number, number, number] {
	if (packedAt >= 0) {
		const packed = Math.round(Number(values[packedAt] ?? 0));
		return [(packed >> 16) & 0xff, (packed >> 8) & 0xff, packed & 0xff];
	}
	if (channelAt.every((i) => i >= 0)) {
		return colorFrom(channelAt.map((i) => Number(values[i] ?? 0)));
	}
	return [DEFAULT_COLOR, DEFAULT_COLOR, DEFAULT_COLOR];
}

/** 二进制行的颜色：同上，值从 DataView 读 */
function binaryRowColor(
	view: DataView,
	base: number,
	packed: PcdField | undefined,
	channel: Array<PcdField | undefined>,
): [number, number, number] {
	if (packed) {
		// PCL 把 RGB 打包进一个 f32/u32：低 24 位是颜色
		const value = Math.round(readPcdValue(view, base, packed));
		return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
	}
	if (channel.every((f) => f !== undefined)) {
		return colorFrom(
			channel.map((f) => readPcdValue(view, base, f as PcdField)),
		);
	}
	return [DEFAULT_COLOR, DEFAULT_COLOR, DEFAULT_COLOR];
}

/** 按 PCD 的 TYPE/SIZE 读一个数 */
function readPcdValue(view: DataView, base: number, field: PcdField): number {
	const at = base + field.offset;
	if (field.type === "F") {
		return field.size === 8
			? view.getFloat64(at, true)
			: view.getFloat32(at, true);
	}
	if (field.type === "U") {
		if (field.size === 8) return Number(view.getBigUint64(at, true));
		if (field.size === 4) return view.getUint32(at, true);
		return field.size === 2 ? view.getUint16(at, true) : view.getUint8(at);
	}
	if (field.size === 8) return Number(view.getBigInt64(at, true));
	if (field.size === 4) return view.getInt32(at, true);
	return field.size === 2 ? view.getInt16(at, true) : view.getInt8(at);
}

/**
 * `.xyz` / `.pts`（纯文本点云）→ 紧凑数组。
 *
 * 行格式：至少三个数（x y z），后面可选 r g b。PTS 的第一行是点数（跳过），
 * `//` 与 `#` 开头的是注释。解析到 MAX_TEXT_POINTS 就停（预览用）。
 */
export function parseTextPoints(bytes: Uint8Array, what: string): SplatData {
	const sink = new PointSink(MAX_TEXT_POINTS);
	let firstLine = true;
	for (const rawLine of new TextDecoder().decode(bytes).split("\n")) {
		const line = rawLine.trim();
		if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;
		const parts = line.split(/\s+/);
		// PTS 的第一行只有点数
		if (firstLine && parts.length === 1) {
			firstLine = false;
			continue;
		}
		firstLine = false;
		if (parts.length < 3) continue;
		const x = Number(parts[0]);
		const y = Number(parts[1]);
		const z = Number(parts[2]);
		if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)))
			continue;
		const rgb =
			parts.length >= 6 ? colorFrom(parts.slice(3, 6).map(Number)) : undefined;
		sink.push(
			x,
			y,
			z,
			rgb?.[0] ?? DEFAULT_COLOR,
			rgb?.[1] ?? DEFAULT_COLOR,
			rgb?.[2] ?? DEFAULT_COLOR,
		);
	}
	return sink.finish(what);
}
