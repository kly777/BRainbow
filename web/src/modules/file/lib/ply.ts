// ── 3DGS / 点云的字节解析（.ply 与 .splat） ──
//
// 只做"文件字节 → 渲染器要的紧凑数组"这一段，纯函数、无 DOM、无 WebGL，便于直测。
// 渲染见 viewers/splat/（着色器与深度排序参考 antimatter15/splat，MIT）。
//
// 两种输入格式，输出同一份布局：
//   · `.ply`：带 ASCII 头、属性按名字对齐（下面解析头部与属性偏移）
//   · `.splat`：参考实现的格式，**定长 32 字节/顶点、而且顺序与我们的紧凑数组完全一致**
//     （见 SPLAT_ROW_BYTES），所以那条路径不需要任何重排，只做校验 + 取景范围 + 采样。
//     判据是内容：没有 PLY 魔数就按 .splat 读（参考实现同样用魔数分辨），
//     这样改了扩展名（或后端把 MIME 认成 octet-stream）也照样能看。
//
// 输出沿用参考实现的 32 字节/顶点布局，顶点着色器按此 texelFetch：
//   [0..12)  位置    xyz  (f32 × 3)
//   [12..24) 缩放    xyz  (f32 × 3，已取 exp)
//   [24..28) 颜色    rgba (u8 × 4，f_dc 转 SH 基色、opacity 过 sigmoid)
//   [28..32) 旋转    四元数 (u8 × 4，已归一化后映射到 0..255)
//
// 3DGS 的 .ply 里 f_rest_* 是球谐高阶项（视点相关颜色），参考实现与这里都不使用：
// 预览场景下用 f_dc 的基色已经足够，省下 45/59 个浮点属性的读取。

/** 每个顶点在紧凑数组里占的字节数 */
export const SPLAT_ROW_BYTES = 32;

/** 是否是 .ply（注册表只按文件名判定，内容能不能渲染交给查看器解析后再说） */
export function isPlyName(name: string): boolean {
	return /\.ply$/i.test(name.trim());
}

/** 是否是 .splat（参考实现的格式，定长 32 字节/顶点） */
export function isSplatName(name: string): boolean {
	return /\.splat$/i.test(name.trim());
}

/** 注册表用：两种格式走同一个查看器 */
export function isSplatLikeName(name: string): boolean {
	return isPlyName(name) || isSplatName(name);
}

/** PLY 魔数（"ply" + 换行）；没有它就不是 PLY，按 .splat 读 */
export function isPlyBytes(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x70 &&
		bytes[1] === 0x6c &&
		bytes[2] === 0x79 &&
		bytes[3] === 0x0a
	);
}

/** 球谐基函数常数（f_dc → RGB 的转换系数） */
const SH_C0 = 0.28209479177387814;

/**
 * 浮点 → 0..255 字节。**必须显式 clamp**：普通 Uint8Array 赋值是取模而不是截断，
 * f_dc 为负数（很常见）时颜色会绕回成亮色（参考实现靠 Uint8ClampedArray 回避这点）。
 */
function toByte(value: number): number {
	if (value <= 0) return 0;
	if (value >= 255) return 255;
	return Math.round(value);
}

export class PlyError extends Error {}

type PlyKind =
	| "float32"
	| "float64"
	| "int32"
	| "uint32"
	| "int16"
	| "uint16"
	| "int8"
	| "uint8";

/** PLY 属性类型 → 字节数与读取方式（标准名与短名都收） */
const PLY_TYPES: Record<string, { kind: PlyKind; size: number }> = {
	float: { kind: "float32", size: 4 },
	float32: { kind: "float32", size: 4 },
	double: { kind: "float64", size: 8 },
	float64: { kind: "float64", size: 8 },
	int: { kind: "int32", size: 4 },
	int32: { kind: "int32", size: 4 },
	uint: { kind: "uint32", size: 4 },
	uint32: { kind: "uint32", size: 4 },
	short: { kind: "int16", size: 2 },
	int16: { kind: "int16", size: 2 },
	ushort: { kind: "uint16", size: 2 },
	uint16: { kind: "uint16", size: 2 },
	char: { kind: "int8", size: 1 },
	int8: { kind: "int8", size: 1 },
	uchar: { kind: "uint8", size: 1 },
	uint8: { kind: "uint8", size: 1 },
};

export interface PlyField {
	kind: PlyKind;
	offset: number;
}

export interface PlyHeader {
	format: "binary_little_endian" | "binary_big_endian" | "ascii";
	vertexCount: number;
	/** 顶点数据起始偏移 */
	dataOffset: number;
	/** 每个顶点占的字节数 */
	rowSize: number;
	/** 顶点属性名 → 读取信息 */
	fields: Map<string, PlyField>;
}

function readValue(
	view: DataView,
	base: number,
	field: PlyField,
	littleEndian: boolean,
): number {
	const at = base + field.offset;
	switch (field.kind) {
		case "float32":
			return view.getFloat32(at, littleEndian);
		case "float64":
			return view.getFloat64(at, littleEndian);
		case "int32":
			return view.getInt32(at, littleEndian);
		case "uint32":
			return view.getUint32(at, littleEndian);
		case "int16":
			return view.getInt16(at, littleEndian);
		case "uint16":
			return view.getUint16(at, littleEndian);
		case "int8":
			return view.getInt8(at);
		default:
			return view.getUint8(at);
	}
}

const HEADER_LIMIT_BYTES = 64 * 1024;

/**
 * 解析 PLY 头部。只统计 `element vertex` 的属性（其他 element 的属性不进行宽，
 * 它们的字节在顶点数据之后，与顶点解析无关）。
 */
export function parsePlyHeader(bytes: Uint8Array): PlyHeader {
	const head = bytes.subarray(0, Math.min(bytes.length, HEADER_LIMIT_BYTES));
	// 头部是 ASCII；用 latin1 逐字节映射，避免多字节解码在二进制区产生替换字符
	let text = "";
	for (const b of head) text += String.fromCharCode(b);

	if (!text.startsWith("ply"))
		throw new PlyError("不是 PLY 文件（缺少 ply 魔数）");
	const endIdx = text.indexOf("end_header");
	if (endIdx < 0) throw new PlyError("PLY 头部不完整（找不到 end_header）");
	// end_header 后面必须紧跟换行，数据从其后开始
	const nl = text.indexOf("\n", endIdx);
	if (nl < 0) throw new PlyError("PLY 头部不完整（end_header 后没有换行）");
	const dataOffset = nl + 1;

	let format: PlyHeader["format"] | undefined;
	let vertexCount = -1;
	let inVertex = false;
	let rowSize = 0;
	const fields = new Map<string, PlyField>();

	for (const rawLine of text.slice(0, endIdx).split("\n")) {
		const line = rawLine.trim();
		if (line.startsWith("format ")) {
			const name = line.split(/\s+/)[1];
			if (name === "ascii") format = "ascii";
			else if (name === "binary_little_endian") format = "binary_little_endian";
			else if (name === "binary_big_endian") format = "binary_big_endian";
			else throw new PlyError(`不支持的 PLY 格式：${name}`);
		} else if (line.startsWith("element ")) {
			const [, name, count] = line.split(/\s+/);
			inVertex = name === "vertex";
			if (inVertex) vertexCount = Number.parseInt(count, 10);
		} else if (line.startsWith("property ") && inVertex) {
			const parts = line.split(/\s+/);
			if (parts[1] === "list") {
				// 顶点属性里出现 list 极少见（面索引才会用），直接判为不支持
				throw new PlyError("顶点属性含 list，暂不支持解析");
			}
			const type = PLY_TYPES[parts[1]];
			if (!type) throw new PlyError(`未知的属性类型：${parts[1]}`);
			fields.set(parts[2], { kind: type.kind, offset: rowSize });
			rowSize += type.size;
		}
	}

	if (!format) throw new PlyError("PLY 头部缺少 format 行");
	if (vertexCount < 0) throw new PlyError("PLY 头部缺少 element vertex");
	return { format, vertexCount, dataOffset, rowSize, fields };
}

export interface SplatBounds {
	/** 鲁棒包围盒中心（各轴 1%/99% 分位的中点）：环绕与取景都以它为目标 */
	center: [number, number, number];
	/**
	 * 各轴鲁棒半宽（≥0），自动取景把它装进画面（见 splat/fit.ts）。
	 *
	 * 为什么是"盒"而不是"半径"：曾经用"到中心的距离 P90"当取景半径，那个量与
	 * 内容在屏幕上的伸展无关 —— 场景像"壳"时（径向距离小、屏幕伸展大）会算得太近
	 * 而溢出画面，场景"扁而长"时会算得太远而只占中间一条。各轴分位如实描述盒子。
	 */
	half: [number, number, number];
	/** 完整包围盒对角线的一半（含离群点），仅供诊断与测试对照 */
	bboxRadius: number;
}

/** 距离分位用的直方图桶数（桶宽 = maxDist/1024，误差可忽略） */
const DISTANCE_BUCKETS = 1024;

/** 取距离分布的 p 分位（直方图法：避免为几十万个浮点排序） */
/**
 * 分位数（直方图法，`DISTANCE_BUCKETS` 个桶）。
 *
 * 用直方图而不是排序：几十万个浮点排一次序要几百毫秒，而且要多一份等长数组；
 * 桶宽只有取值范围的 1/1024，对"取景"这种用途完全够。
 * `valueAt(i)` 按需取值，于是同一份实现既能算坐标中位数、也能算距离分位。
 */
function histogramQuantile(
	count: number,
	min: number,
	max: number,
	p: number,
	valueAt: (index: number) => number,
): number {
	if (count === 0) return max;
	if (!(max > min)) return max;
	const span = max - min;
	const counts = new Uint32Array(DISTANCE_BUCKETS);
	for (let i = 0; i < count; i++) {
		const t = (valueAt(i) - min) / span;
		const bucket = Math.min(
			DISTANCE_BUCKETS - 1,
			Math.max(0, (t * DISTANCE_BUCKETS) | 0),
		);
		counts[bucket]++;
	}
	const target = Math.ceil(count * p);
	let seen = 0;
	for (let i = 0; i < DISTANCE_BUCKETS; i++) {
		seen += counts[i];
		// 返回该桶的中心：误差只有半个桶宽，且不系统性偏大（偏大会让取景变远）
		if (seen >= target) return min + ((i + 0.5) / DISTANCE_BUCKETS) * span;
	}
	return max;
}

export interface SplatData {
	/** 紧凑顶点数组（每顶点 SPLAT_ROW_BYTES 字节），已按 importance 从大到小排序 */
	bytes: Uint8Array;
	vertexCount: number;
	bounds: SplatBounds;
	/**
	 * 顶点位置的等间隔抽样（扁平 xyz），供自动取景按点的分布定距离。
	 *
	 * 为什么不只用包围盒：盒的角点常常是"空角"（那个坐标组合上没有点），对长尾场景
	 * 会过于保守 —— 实测某场景按盒取景时点在屏幕上的 95 分位只有半幅的 0.41。
	 */
	sample: Float32Array;
	/** 没有高斯参数（scale/rot）的普通点云：按小圆点渲染 */
	pointCloud: boolean;
}

/** 取景采样的点数上限：取景只关心"点云散布成什么样"，不需要全部顶点 */
export const FIT_SAMPLE_POINTS = 8192;

/** 位置数组 → 取景采样（等间隔抽）。等间隔抽样对点的分布是无偏的 */
export function fitSample(
	positions: Float32Array,
	vertexCount: number,
): Float32Array {
	if (vertexCount <= 0) return new Float32Array(0);
	const stride = Math.max(1, Math.ceil(vertexCount / FIT_SAMPLE_POINTS));
	const count = Math.ceil(vertexCount / stride);
	const out = new Float32Array(count * 3);
	for (let i = 0, j = 0; i < vertexCount; i += stride, j++) {
		out[j * 3] = positions[i * 3];
		out[j * 3 + 1] = positions[i * 3 + 1];
		out[j * 3 + 2] = positions[i * 3 + 2];
	}
	return out;
}

/**
 * 取景范围：三个轴各自的 1% / 99% 分位，取中点当中心、半宽当尺寸；另给完整包围盒
 * 对角线半径供诊断对照。`.ply` 与 `.splat` 两条解析路径共用。
 *
 * 为什么不用"到中心的距离分位数"（曾经的 P90 半径）：那个量与"内容在屏幕上占多大"
 * 无关，实测两个真实场景一个溢出到 132%×241%（被裁切），一个在 2.3:1 的预览区里
 * 只占 42.6% 的高度（上下大片空白）。原因是径向距离分不出轴向伸展：场景像"壳"
 * （点到中心径向距离小、屏幕伸展大）或"扁而长"（y 只有 ±13 而 x/z 是 ±29/±44）时
 * 都会偏得很离谱。各轴分位则如实描述了一个盒子，自动取景要的是它。
 *
 * 分位而非 min/max：1% 的尾巴（浮点噪点、天空点）不该把取景推远 ——
 * 完整包围盒只用来算 bboxRadius。
 */
export function boundsFromPositions(
	positions: Float32Array,
	count: number,
): SplatBounds {
	// 空输入给零范围：min/max 会停在 ±Infinity，分位再平均一下就是 NaN。
	// 调用方各自也拦了"没有顶点"，但这是导出函数，自己也得站得住
	if (count <= 0) return { center: [0, 0, 0], half: [0, 0, 0], bboxRadius: 0 };
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let minZ = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	let maxZ = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const x = positions[i * 3];
		const y = positions[i * 3 + 1];
		const z = positions[i * 3 + 2];
		if (x < minX) minX = x;
		if (y < minY) minY = y;
		if (z < minZ) minZ = z;
		if (x > maxX) maxX = x;
		if (y > maxY) maxY = y;
		if (z > maxZ) maxZ = z;
	}

	const quantile = (axis: 0 | 1 | 2, p: number, lo: number, hi: number) =>
		histogramQuantile(count, lo, hi, p, (i) => positions[i * 3 + axis]);
	const low: [number, number, number] = [
		quantile(0, 0.01, minX, maxX),
		quantile(1, 0.01, minY, maxY),
		quantile(2, 0.01, minZ, maxZ),
	];
	const high: [number, number, number] = [
		quantile(0, 0.99, minX, maxX),
		quantile(1, 0.99, minY, maxY),
		quantile(2, 0.99, minZ, maxZ),
	];
	const center: [number, number, number] = [
		(low[0] + high[0]) / 2,
		(low[1] + high[1]) / 2,
		(low[2] + high[2]) / 2,
	];
	const half: [number, number, number] = [
		(high[0] - low[0]) / 2,
		(high[1] - low[1]) / 2,
		(high[2] - low[2]) / 2,
	];
	const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
	const bboxRadius = Number.isFinite(diag) && diag > 0 ? diag / 2 : 0;
	return { center, half, bboxRadius };
}

/** 缺了这个就没法确定顶点位置 */
const REQUIRED = ["x", "y", "z"] as const;

/**
 * 把 PLY 字节转成渲染用的紧凑数组。
 *
 * 3DGS 判定：有 `scale_0`（或 `f_dc_0`）即按高斯泼溅处理，否则按普通点云
 * （参考实现同样是这样兜底的：尺度取 0.01、旋转取单位四元数、颜色取 red/green/blue）。
 */
export function buildSplatData(
	bytes: Uint8Array,
	header?: PlyHeader,
): SplatData {
	const h = header ?? parsePlyHeader(bytes);
	if (h.format === "ascii")
		throw new PlyError("ASCII 格式的 PLY 暂不支持预览（请用二进制 PLY）");
	const { fields, vertexCount, dataOffset, rowSize } = h;
	if (vertexCount <= 0) throw new PlyError("PLY 里没有顶点");

	for (const name of REQUIRED)
		if (!fields.has(name)) throw new PlyError(`PLY 缺少 ${name} 属性`);

	const isGaussian = fields.has("scale_0") || fields.has("f_dc_0");
	const hasRgb = fields.has("red") && fields.has("green") && fields.has("blue");
	if (!isGaussian && !hasRgb)
		throw new PlyError(
			"PLY 既没有高斯参数（scale_0）也没有颜色（red/green/blue）",
		);

	const end = dataOffset + vertexCount * rowSize;
	if (end > bytes.length) throw new PlyError("PLY 数据不完整（文件被截断？）");

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const littleEndian = h.format !== "binary_big_endian";
	const need = (name: string): PlyField => {
		const f = fields.get(name);
		if (!f) throw new PlyError(`PLY 缺少 ${name} 属性`);
		return f;
	};
	const at = (base: number, name: string) =>
		readValue(view, base, need(name), littleEndian);

	const fx = need("x");
	const fy = need("y");
	const fz = need("z");
	const fields3 = isGaussian
		? ([
				need("scale_0"),
				need("scale_1"),
				need("scale_2"),
				need("rot_0"),
				need("rot_1"),
				need("rot_2"),
				need("rot_3"),
				need("opacity"),
			] as const)
		: undefined;

	// 第一遍：位置 + importance（体积 × 不透明度，大的先渲染，参考实现同此）
	// 顺便把位置存下来：取景范围要从它算（见 boundsFromPositions）
	const positions = new Float32Array(vertexCount * 3);
	const importance = new Float32Array(vertexCount);
	const order = new Uint32Array(vertexCount);

	for (let i = 0; i < vertexCount; i++) {
		const base = dataOffset + i * rowSize;
		const x = readValue(view, base, fx, littleEndian);
		const y = readValue(view, base, fy, littleEndian);
		const z = readValue(view, base, fz, littleEndian);
		positions[i * 3] = x;
		positions[i * 3 + 1] = y;
		positions[i * 3 + 2] = z;
		order[i] = i;
		if (fields3) {
			const size =
				Math.exp(at(base, "scale_0")) *
				Math.exp(at(base, "scale_1")) *
				Math.exp(at(base, "scale_2"));
			const opacity = 1 / (1 + Math.exp(-at(base, "opacity")));
			importance[i] = size * opacity;
		}
	}

	// 第二遍：按 importance 降序（点云没有 importance，保持文件顺序）
	if (fields3) {
		// 用普通数组承载后整体排序：Uint32Array.prototype.sort 的比较器签名不同
		const idx = Array.from(order);
		idx.sort((a, b) => importance[b] - importance[a]);
		order.set(idx);
	}

	const out = new Uint8Array(vertexCount * SPLAT_ROW_BYTES);
	const outView = new DataView(out.buffer);
	for (let j = 0; j < vertexCount; j++) {
		const row = order[j];
		const base = dataOffset + row * rowSize;
		const o = j * SPLAT_ROW_BYTES;

		outView.setFloat32(o, readValue(view, base, fx, littleEndian), true);
		outView.setFloat32(o + 4, readValue(view, base, fy, littleEndian), true);
		outView.setFloat32(o + 8, readValue(view, base, fz, littleEndian), true);

		if (fields3) {
			outView.setFloat32(o + 12, Math.exp(at(base, "scale_0")), true);
			outView.setFloat32(o + 16, Math.exp(at(base, "scale_1")), true);
			outView.setFloat32(o + 20, Math.exp(at(base, "scale_2")), true);

			// 四元数归一化后映射到 0..255（着色器按 (u8-128)/128 还原）
			const q0 = at(base, "rot_0");
			const q1 = at(base, "rot_1");
			const q2 = at(base, "rot_2");
			const q3 = at(base, "rot_3");
			const len = Math.hypot(q0, q1, q2, q3) || 1;
			out[o + 28] = toByte((q0 / len) * 128 + 128);
			out[o + 29] = toByte((q1 / len) * 128 + 128);
			out[o + 30] = toByte((q2 / len) * 128 + 128);
			out[o + 31] = toByte((q3 / len) * 128 + 128);

			out[o + 24] = toByte((0.5 + SH_C0 * at(base, "f_dc_0")) * 255);
			out[o + 25] = toByte((0.5 + SH_C0 * at(base, "f_dc_1")) * 255);
			out[o + 26] = toByte((0.5 + SH_C0 * at(base, "f_dc_2")) * 255);
			out[o + 27] = toByte((1 / (1 + Math.exp(-at(base, "opacity")))) * 255);
		} else {
			// 普通点云：固定小尺度 + 单位四元数 + 直接取 RGB
			outView.setFloat32(o + 12, 0.01, true);
			outView.setFloat32(o + 16, 0.01, true);
			outView.setFloat32(o + 20, 0.01, true);
			out[o + 24] = toByte(at(base, "red"));
			out[o + 25] = toByte(at(base, "green"));
			out[o + 26] = toByte(at(base, "blue"));
			out[o + 27] = 255;
			// 单位四元数 (1,0,0,0)：着色器按 (u8-128)/128 还原，所以 0 写成 128
			out[o + 28] = 255;
			out[o + 29] = 128;
			out[o + 30] = 128;
			out[o + 31] = 128;
		}
	}

	return {
		bytes: out,
		vertexCount,
		bounds: boundsFromPositions(positions, vertexCount),
		sample: fitSample(positions, vertexCount),
		pointCloud: !fields3,
	};
}

/**
 * `.splat`（参考实现的格式）→ 渲染用的紧凑数组。
 *
 * 与 `.ply` 路径的最大区别：**这个格式的字节布局就是我们的紧凑数组**（定长 32 字节、
 * 位置/缩放/颜色/四元数的顺序也一致），所以不需要逐属性重排，直接原样带走，
 * 只做三件事：校验长度、算取景范围、抽位置样本。参考实现的 `convert.py` 写的正是
 * 这个布局，而它自己的 demo（train.splat / nike.splat）就是这种文件。
 *
 * 没有"点云"分支：这个格式必然带高斯参数（缩放与四元数）。
 */
export function buildSplatDataFromSplat(bytes: Uint8Array): SplatData {
	if (bytes.length < SPLAT_ROW_BYTES)
		throw new PlyError("文件太小，不像 .splat（每顶点 32 字节）");
	if (bytes.length % SPLAT_ROW_BYTES !== 0)
		throw new PlyError(
			`不是 PLY，也不是 .splat：长度 ${bytes.length} 不是 ${SPLAT_ROW_BYTES} 的整数倍`,
		);
	const vertexCount = bytes.length / SPLAT_ROW_BYTES;
	// Float32Array 视图要求 4 字节对齐；分段请求拿到的 subarray 可能不满足，这时复制一份
	const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
	const f = new Float32Array(
		aligned.buffer,
		aligned.byteOffset,
		vertexCount * 8,
	);
	// 位置在每行开头，取景要用：抽成紧凑数组（fitSample 的等间隔抽样对它无偏）
	const positions = new Float32Array(vertexCount * 3);
	for (let i = 0; i < vertexCount; i++) {
		positions[i * 3] = f[i * 8];
		positions[i * 3 + 1] = f[i * 8 + 1];
		positions[i * 3 + 2] = f[i * 8 + 2];
	}
	return {
		bytes: aligned,
		vertexCount,
		bounds: boundsFromPositions(positions, vertexCount),
		sample: fitSample(positions, vertexCount),
		pointCloud: false,
	};
}

/** 紧凑数组 → 顶点着色器要的 RGBA32UI 纹理数据（每顶点两个 texel） */
export function buildSplatTexture(
	data: SplatData,
	texWidth: number,
): { texdata: Uint32Array; texHeight: number } {
	const { bytes, vertexCount } = data;
	const texHeight = Math.ceil((2 * vertexCount) / texWidth);
	const texdata = new Uint32Array(texWidth * texHeight * 4);
	const texF = new Float32Array(texdata.buffer);
	const texU8 = new Uint8Array(texdata.buffer);
	const srcF = new Float32Array(
		bytes.buffer,
		bytes.byteOffset,
		bytes.byteLength / 4,
	);

	// 半精度打包（WebGL 的 unpackHalf2x16 需要 half，不能直接塞 float）
	const f32 = new Float32Array(1);
	const i32 = new Int32Array(f32.buffer);
	const toHalf = (value: number): number => {
		f32[0] = value;
		const f = i32[0];
		const sign = (f >> 31) & 0x0001;
		const exp = (f >> 23) & 0x00ff;
		let frac = f & 0x007fffff;
		let newExp: number;
		if (exp === 0) newExp = 0;
		else if (exp < 113) {
			newExp = 0;
			frac |= 0x00800000;
			frac >>= 113 - exp;
			if (frac & 0x01000000) {
				newExp = 1;
				frac = 0;
			}
		} else if (exp < 142) newExp = exp - 112;
		else {
			newExp = 31;
			frac = 0;
		}
		return (sign << 15) | (newExp << 10) | (frac >> 13);
	};
	const packHalf2 = (x: number, y: number) =>
		(toHalf(x) | (toHalf(y) << 16)) >>> 0;

	for (let i = 0; i < vertexCount; i++) {
		// 位置：texel 偶数位
		texF[8 * i + 0] = srcF[8 * i + 0];
		texF[8 * i + 1] = srcF[8 * i + 1];
		texF[8 * i + 2] = srcF[8 * i + 2];
		// 颜色：塞进第二个 texel 的第 4 个分量（着色器按位取出）
		texU8[4 * (8 * i + 7) + 0] = bytes[i * SPLAT_ROW_BYTES + 24];
		texU8[4 * (8 * i + 7) + 1] = bytes[i * SPLAT_ROW_BYTES + 25];
		texU8[4 * (8 * i + 7) + 2] = bytes[i * SPLAT_ROW_BYTES + 26];
		texU8[4 * (8 * i + 7) + 3] = bytes[i * SPLAT_ROW_BYTES + 27];

		const s0 = srcF[8 * i + 3 + 0];
		const s1 = srcF[8 * i + 3 + 1];
		const s2 = srcF[8 * i + 3 + 2];
		const rot = [
			(bytes[i * SPLAT_ROW_BYTES + 28] - 128) / 128,
			(bytes[i * SPLAT_ROW_BYTES + 29] - 128) / 128,
			(bytes[i * SPLAT_ROW_BYTES + 30] - 128) / 128,
			(bytes[i * SPLAT_ROW_BYTES + 31] - 128) / 128,
		];

		// M = S · R，协方差 = Mᵀ·M 的对称部分（只取 6 个独立分量）
		const M = [
			1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
			2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
			2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),

			2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
			1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
			2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),

			2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
			2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
			1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
		].map((k, idx) => k * [s0, s1, s2][Math.floor(idx / 3)]);

		const sigma = [
			M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
			M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
			M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
			M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
			M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
			M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
		];

		texdata[8 * i + 4] = packHalf2(4 * sigma[0], 4 * sigma[1]);
		texdata[8 * i + 5] = packHalf2(4 * sigma[2], 4 * sigma[3]);
		texdata[8 * i + 6] = packHalf2(4 * sigma[4], 4 * sigma[5]);
	}

	return { texdata, texHeight };
}
