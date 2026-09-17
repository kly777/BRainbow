// ── 上传限额：分档判断、格式化、以及"与后端镜像一致"的交叉校验 ──
//
// 前端这套数字是后端 `src/modules/file/limits.rs` 的镜像，两处必须同步。
// 最后那个 describe 直接读 Rust 源码比对，是防漂移的唯一硬保障。

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	EXT_TIER,
	formatBytes,
	MIME_TIER,
	type TierKey,
	UPLOAD_TIERS,
	uploadTierFor,
	validateUploadFile,
} from "./uploadLimits.ts";

const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;

/** 只带校验用到的三个字段，size 可以随便写（不真分配内存） */
const candidate = (name: string, type: string, size = 1) => ({
	name,
	type,
	size,
});

describe("uploadTierFor", () => {
	it("浏览器给了 MIME 就用 MIME", () => {
		expect(uploadTierFor(candidate("a.png", "image/png")).label).toBe("图片");
		expect(uploadTierFor(candidate("a.svg", "image/svg+xml")).label).toBe(
			"SVG",
		);
		expect(uploadTierFor(candidate("a.mp4", "video/mp4")).label).toBe("视频");
		expect(uploadTierFor(candidate("a.pdf", "application/pdf")).label).toBe(
			"文档",
		);
	});

	it("MIME 大小写与空白容错", () => {
		expect(uploadTierFor(candidate("a.png", " IMAGE/PNG ")).label).toBe("图片");
	});

	it("MIME 为空时退到扩展名（未注册类型浏览器一律报空串）", () => {
		expect(uploadTierFor(candidate("scene.PLY", "")).label).toBe("其他文件");
		expect(uploadTierFor(candidate("shot.TIF", "")).label).toBe("图片");
		expect(uploadTierFor(candidate("clip.mov", "")).label).toBe("视频");
	});

	it("音视频共用扩展名取宽松档（.ogg/.webm 可能比 audio 档大）", () => {
		expect(uploadTierFor(candidate("x.ogg", "")).maxBytes).toBe(
			UPLOAD_TIERS.video.maxBytes,
		);
		expect(uploadTierFor(candidate("x.webm", "")).maxBytes).toBe(
			UPLOAD_TIERS.video.maxBytes,
		);
	});

	it("扩展名也判不出就按 other 档放行", () => {
		expect(uploadTierFor(candidate("data.bin", "")).maxBytes).toBe(
			UPLOAD_TIERS.other.maxBytes,
		);
		// 无扩展名 / 点开头的隐藏文件都不得被当成扩展名
		expect(uploadTierFor(candidate("Makefile", "")).label).toBe("其他文件");
		expect(uploadTierFor(candidate(".gitignore", "")).label).toBe("其他文件");
		expect(
			uploadTierFor(candidate("archive.tar.gz", "application/gzip")).label,
		).toBe("其他文件");
	});

	it("白名单外类型即使像图片也不收紧（不误伤用户）", () => {
		// image/heic 不在后端白名单里 → 后端按 other 档收，前端也不得更严
		expect(uploadTierFor(candidate("a.heic", "image/heic")).maxBytes).toBe(
			UPLOAD_TIERS.other.maxBytes,
		);
	});
});

describe("validateUploadFile", () => {
	it("空文件直接拦下（后端也必拒）", () => {
		expect(
			validateUploadFile(candidate("empty.txt", "text/plain", 0)),
		).toContain("空文件");
	});

	it("恰好等于上限放行，多 1 字节拒绝", () => {
		const max = UPLOAD_TIERS.image.maxBytes;
		expect(validateUploadFile(candidate("a.png", "image/png", max))).toBeNull();
		const over = validateUploadFile(candidate("a.png", "image/png", max + 1));
		expect(over).toContain("图片上限 200 MB");
		expect(over).toContain("200 MB");
	});

	it("SVG 用更紧的一档，且提示里给的是文件实际大小", () => {
		const msg = validateUploadFile(
			candidate("icon.svg", "image/svg+xml", 30 * MIB),
		);
		expect(msg).toContain("SVG上限 20 MB");
		expect(msg).toContain("30 MB");
	});

	it("3DGS 场景这类大文件按 4GB 档放行", () => {
		expect(
			validateUploadFile(candidate("scene.ply", "", 1.5 * GIB)),
		).toBeNull();
		expect(validateUploadFile(candidate("scene.ply", "", 5 * GIB))).toContain(
			"4 GB",
		);
	});
});

describe("formatBytes", () => {
	it("1024 进制，整数不带小数点", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1024)).toBe("1 KB");
		expect(formatBytes(200 * MIB)).toBe("200 MB");
		expect(formatBytes(GIB)).toBe("1 GB");
		expect(formatBytes(4 * GIB)).toBe("4 GB");
	});

	it("非整数保留一位小数", () => {
		expect(formatBytes(1.5 * MIB)).toBe("1.5 MB");
	});
});

// ── 与后端分档镜像一致 ──

// vitest 的 import.meta.url 不是 file 协议，按工作目录找（web/ 下跑或仓库根下跑都认）
function backendSource(): string {
	const path = ["../src/modules/file/limits.rs", "src/modules/file/limits.rs"]
		.map((p) => resolve(process.cwd(), p))
		.find(existsSync);
	if (!path) {
		throw new Error(
			`找不到后端 src/modules/file/limits.rs（cwd=${process.cwd()}），镜像校验无法进行`,
		);
	}
	return readFileSync(path, "utf8");
}

/**
 * 取 `const NAME: u64 = <表达式>;` 的数值。表达式只允许数字、`*`、`+`
 * （分档常量就是这么写的），不做 eval。
 */
function backendConst(name: string): number {
	const source = backendSource();
	const matched = source.match(
		new RegExp(`const ${name}\\s*:\\s*\\w+\\s*=\\s*([^;]+);`),
	);
	if (!matched)
		throw new Error(`后端 limits.rs 里找不到常量 ${name}（改名或搬走了？）`);
	const expr = matched[1].replace(/_/g, "");
	const product = (term: string) =>
		term
			.split("*")
			.map((part) => Number(part.trim()))
			.reduce((acc, n) => {
				if (!Number.isFinite(n)) {
					throw new Error(`${name} 的表达式无法求值: ${matched[1]}`);
				}
				return acc * n;
			}, 1);
	return expr.split("+").reduce((acc, term) => acc + product(term), 0);
}

/** 后端 ALLOWED_MIMES 表里的 (mime, 上限常量名) 对 */
function backendMimeConsts(): Array<{ mime: string; constName: string }> {
	const source = backendSource();
	const start = source.indexOf("const ALLOWED_MIMES");
	const end = source.indexOf("];", start);
	if (start < 0 || end < 0)
		throw new Error("后端 limits.rs 里找不到 ALLOWED_MIMES 表");
	const table = source.slice(start, end);
	// 多行元组（超长 MIME）rustfmt 会在末项后留逗号，故 `,?`
	return [
		...table.matchAll(
			/\(\s*"([^"]+)"\s*,\s*"[a-z]+"\s*,\s*([A-Z_]+)\s*,?\s*\)/g,
		),
	].map((m) => ({ mime: m[1], constName: m[2] }));
}

describe("与后端分档一致", () => {
	it("每档的字节数等于后端常量", () => {
		const expected: Record<TierKey, number> = {
			image: backendConst("IMAGE_MAX_SIZE"),
			svg: backendConst("SVG_MAX_SIZE"),
			audio: backendConst("AUDIO_MAX_SIZE"),
			document: backendConst("DOCUMENT_MAX_SIZE"),
			video: backendConst("FALLBACK_MAX_SIZE"),
			other: backendConst("FALLBACK_MAX_SIZE"),
		};
		for (const [key, maxBytes] of Object.entries(expected)) {
			expect(UPLOAD_TIERS[key as TierKey].maxBytes, `档位 ${key}`).toBe(
				maxBytes,
			);
		}
	});

	it("白名单 MIME 与后端表双向一致（不漏也不多）", () => {
		const rows = backendMimeConsts();
		// 先钉住解析器本身没解析歪：白名单现有 27 条（加了 pptx），漏读会让下面的比对空转
		expect(rows.length).toBe(27);
		for (const { mime, constName } of rows) {
			const tierKey = MIME_TIER[mime];
			expect(tierKey, `前端缺 ${mime} 的档位`).toBeDefined();
			expect(
				UPLOAD_TIERS[tierKey].maxBytes,
				`${mime} 的档位与后端 ${constName} 不一致`,
			).toBe(backendConst(constName));
		}
		const backendMimes = new Set(rows.map((r) => r.mime));
		for (const mime of Object.keys(MIME_TIER)) {
			expect(
				backendMimes.has(mime),
				`前端多出 ${mime}（后端白名单里没有）`,
			).toBe(true);
		}
	});

	it("请求体上限覆盖最大单文件（与后端那条测试同义）", () => {
		// 先确认常量求值器真读到了数（body 上限的表达式还含 `+`，解析歪了会静默算出别的值）
		expect(backendConst("FALLBACK_MAX_SIZE")).toBe(4 * GIB);
		expect(backendConst("SVG_MAX_SIZE")).toBe(20 * MIB);
		const maxFile = Math.max(
			...Object.values(UPLOAD_TIERS).map((t) => t.maxBytes),
		);
		expect(backendConst("UPLOAD_BODY_LIMIT_BYTES")).toBeGreaterThan(maxFile);
	});

	it("扩展名兜底不得比 MIME 档更严（宁可漏放也不误伤）", () => {
		for (const [mime, mimeTier] of Object.entries(MIME_TIER)) {
			const ext = mime.slice(mime.indexOf("/") + 1);
			const extTier = EXT_TIER[ext];
			if (!extTier) continue; // svg+xml / msword 这类对不上扩展名的跳过
			expect(
				UPLOAD_TIERS[extTier].maxBytes,
				`扩展名 .${ext} 的档位比 ${mime} 更严`,
			).toBeGreaterThanOrEqual(UPLOAD_TIERS[mimeTier].maxBytes);
		}
	});
});
