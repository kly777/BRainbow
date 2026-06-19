/**
 * 随机彩虹图标生成器
 *
 * 使用 LCH 色彩空间生成感知均匀的有关系颜色，复用 Color 类做色域裁剪。
 */

import { Angle } from "./angle.ts";
import { Color, type Oklch } from "./color.ts";

/** 随机角度 (5° ~ 80°) */
function randomAngle(): Angle {
	return Angle.fromDegree(5 + Math.random() * 75);
}

/** 生成 n 个有关系的 LCH 颜色 */
function generateColors(n: number): string[] {
	const L = 0.45 + Math.random() * 0.2; // 0.45~0.65
	const C = 0.08 + Math.random() * 0.16; // 0.08~0.24

	// 两个锚点色相，差距 ≤ 90°
	const h1 = Math.random() * 360;
	const h2 = (h1 + (Math.random() - 0.5) * 180 + 360) % 360;

	// 最短弧方向
	let diff = h2 - h1;
	if (diff > 180) diff -= 360;
	else if (diff < -180) diff += 360;

	return Array.from({ length: n }, (_, i) => {
		const t = n === 1 ? 0 : i / (n - 1);
		const h = (((h1 + diff * t) % 360) + 360) % 360;
		const lch: Oklch = { L, C, h };
		return Color.fromOklch(lch).toHex();
	});
}

// ═══════════════════════════════════════════
// SVG 生成
// ═══════════════════════════════════════════

function buildSvg(colors: string[], angle: Angle, size: number): string {
	const deg = angle.radian;
	const cos = Math.cos(deg);
	const sin = Math.sin(deg);
	const tan = Math.tan(deg);
	const hSum = size * (sin + cos);
	const rh = hSum / colors.length;
	const rw = size / cos + 2 * rh * tan;
	const yo = rh / cos;
	const xOff = tan * rh;

	const polygons = colors.map((color, i) => {
		const yBase = yo * i;
		const ax = -xOff * cos;
		const ay = yBase + xOff * sin;
		const bx = (rw - xOff) * cos;
		const by = yBase - (rw - xOff) * sin;
		const cx = (rw - xOff) * cos + rh * sin;
		const cy = yBase - (rw - xOff) * sin + rh * cos;
		const dx = -xOff * cos + rh * sin;
		const dy = yBase + xOff * sin + rh * cos;
		return `<polygon points="${ax},${ay} ${bx},${by} ${cx},${cy} ${dx},${dy}" fill="${color}" />`;
	});

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="geometricPrecision"><title>Brainbow</title>${polygons.join("")}</svg>`;
}

function setFavicon(url: string): void {
	let link = document.querySelector<HTMLLinkElement>("link[rel~='icon']");
	if (!link) {
		link = document.createElement("link");
		link.rel = "icon";
		document.head.appendChild(link);
	}
	link.href = url;
}

export function generateIcon(size = 64): void {
	const n = 5 + Math.floor(Math.random() * 9); // 5~13 条
	const colors = generateColors(n);
	const angle = randomAngle();
	const svg = buildSvg(colors, angle, size);
	setFavicon(`data:image/svg+xml,${encodeURIComponent(svg)}`);
}
