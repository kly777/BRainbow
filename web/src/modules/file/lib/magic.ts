// ── 文件头签名识别与十六进制排版（纯函数，便于直测） ──
//
// 用途：`other` 类别（后端白名单外的格式）没有专用查看器时，至少能回答
// "这文件到底是什么"。只读文件头若干字节，判断依据是各家格式的固定魔数。

export interface HexRow {
	offset: string;
	hex: string;
	ascii: string;
}

/** 每行字节数（经典 xxd 排版） */
const BYTES_PER_ROW = 16;

/**
 * 字节 → 十六进制行（末行补空格对齐 ASCII 列）。
 *
 * `baseOffset` 是本段在文件中的起始偏移：十六进制查看器按 4KB 分段取内容，
 * 第二段之后的左侧偏移量必须接着文件真实位置往下数，否则每段都从 00000000 开始。
 */
export function hexRows(bytes: Uint8Array, baseOffset = 0): HexRow[] {
	const rows: HexRow[] = [];
	for (let i = 0; i < bytes.length; i += BYTES_PER_ROW) {
		const slice = bytes.subarray(i, i + BYTES_PER_ROW);
		const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0"))
			.join(" ")
			.padEnd(BYTES_PER_ROW * 3 - 1);
		const ascii = Array.from(slice, (b) =>
			b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".",
		).join("");
		rows.push({
			offset: (baseOffset + i).toString(16).padStart(8, "0"),
			hex,
			ascii,
		});
	}
	return rows;
}

/** 常见文件头签名。顺序无关（签名互不前缀冲突），取值给人看 */
const SIGNATURES: Array<{ bytes: number[]; label: string }> = [
	{
		bytes: [0x50, 0x4b, 0x03, 0x04],
		label: "ZIP 容器（zip / docx / xlsx / epub / jar 都是它）",
	},
	{ bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },
	{ bytes: [0x89, 0x50, 0x4e, 0x47], label: "PNG 图片" },
	{ bytes: [0xff, 0xd8, 0xff], label: "JPEG 图片" },
	{ bytes: [0x47, 0x49, 0x46, 0x38], label: "GIF 图片" },
	{ bytes: [0x42, 0x4d], label: "BMP 图片" },
	{ bytes: [0x38, 0x42, 0x50, 0x53], label: "Photoshop 文档（PSD）" },
	{ bytes: [0x52, 0x49, 0x46, 0x46], label: "RIFF 容器（wav / webp / avi）" },
	{ bytes: [0x4f, 0x67, 0x67, 0x53], label: "Ogg 流（ogg / opus）" },
	{ bytes: [0x49, 0x44, 0x33], label: "MP3（带 ID3 标签）" },
	{ bytes: [0x66, 0x4c, 0x61, 0x43], label: "FLAC 音频" },
	{ bytes: [0x1a, 0x45, 0xdf, 0xa3], label: "Matroska / WebM 视频" },
	{ bytes: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65], label: "SQLite 数据库" },
	{ bytes: [0x1f, 0x8b], label: "gzip 压缩包" },
	{ bytes: [0x42, 0x5a, 0x68], label: "bzip2 压缩包" },
	{ bytes: [0x37, 0x7a, 0xbc, 0xaf], label: "7z 压缩包" },
	{ bytes: [0x52, 0x61, 0x72, 0x21], label: "RAR 压缩包" },
	{ bytes: [0x70, 0x6c, 0x79], label: "PLY 3D 模型" },
	{ bytes: [0x67, 0x6c, 0x54, 0x46], label: "glTF 3D 模型（二进制）" },
	{ bytes: [0x7b], label: "JSON 文本（以 { 开头）" },
];

/** 看起来是不是文本：ASCII 可见字符 + 常见空白（高位字节按 UTF-8 放行） */
export function looksTextual(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return false;
	let textual = 0;
	for (const b of bytes) {
		if (
			b === 0x09 ||
			b === 0x0a ||
			b === 0x0d ||
			(b >= 0x20 && b < 0x7f) ||
			b >= 0x80
		)
			textual++;
	}
	return textual / bytes.length > 0.95;
}

/** 文件头 → 人话；认不出也给出"文本 / 未识别二进制"两类结论 */
export function sniffKind(bytes: Uint8Array | undefined): string {
	if (!bytes || bytes.length === 0) return "空文件";
	for (const sig of SIGNATURES) {
		if (
			sig.bytes.length <= bytes.length &&
			sig.bytes.every((b, i) => bytes[i] === b)
		)
			return sig.label;
	}
	return looksTextual(bytes)
		? "文本（没有已知的二进制签名）"
		: "未识别的二进制格式";
}
