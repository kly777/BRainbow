import { Angle, Color } from "@lib/utils";
import { createMemo, createSignal, type Setter } from "solid-js";
import { RAINBOW_SQUARE_SIZE, rainbowGeometry } from "../lib/geometry.ts";
import type { ShapeRender } from "../RainbowDrawer";

export interface RainbowGeneratorApi {
	colors: () => Color[];
	setColors: Setter<Color[]>;
	angle: () => Angle;
	setAngle: Setter<Angle>;
	shapeRender: () => ShapeRender;
	setShapeRender: (mode: ShapeRender) => void;
	rectWidth: () => number;
	rectHeight: () => number;
	heightSum: () => number;
	exportSvg: () => void;
	exportPng: () => void;
	bindSvg: (el: SVGSVGElement) => void;
}

export function useRainbowGenerator(): RainbowGeneratorApi {
	const L = 0.7;
	const C = 0.173;
	const h_offset = 29;

	const [colors, setColors] = createSignal<Color[]>([
		Color.fromOklch({ L, C, h: h_offset }),
		Color.fromOklch({ L, C, h: 360 / 7 + h_offset }),
		Color.fromOklch({ L, C, h: (360 / 7) * 2 + h_offset }),
		Color.fromOklch({ L, C, h: (360 / 7) * 3 + h_offset }),
		Color.fromOklch({ L, C, h: (360 / 7) * 4 + h_offset }),
		Color.fromOklch({ L, C, h: (360 / 7) * 5 + h_offset }),
		Color.fromOklch({ L, C, h: (360 / 7) * 6 + h_offset }),
	]);

	const squareSize = RAINBOW_SQUARE_SIZE;

	const [angle, setAngle] = createSignal<Angle>(
		new Angle(Math.PI * (43.5 / 360)),
	);
	const [shapeRender, setShapeRender] =
		createSignal<ShapeRender>("geometricPrecision");

	let svgEl: SVGSVGElement | null = null;

	// 几何尺寸：与 RainbowDrawer 共用 rainbowGeometry 单一来源
	const geo = createMemo(() =>
		rainbowGeometry(squareSize, angle().radian, colors().length),
	);

	const toBase64 = (bytes: Uint8Array): string => {
		const CHUNK = 0x8000;
		const parts: string[] = [];
		for (let i = 0; i < bytes.length; i += CHUNK) {
			parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
		}
		return btoa(parts.join(""));
	};

	const download = (url: string, filename: string) => {
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	};

	const exportSvg = () => {
		if (!svgEl) return;
		const clone = svgEl.cloneNode(true) as SVGSVGElement;
		clone.setAttribute("width", String(squareSize));
		clone.setAttribute("height", String(squareSize));
		const xml = new XMLSerializer().serializeToString(clone);
		const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], {
			type: "image/svg+xml",
		});
		download(URL.createObjectURL(blob), "rainbow.svg");
	};

	const exportPng = () => {
		if (!svgEl) return;
		const clone = svgEl.cloneNode(true) as SVGSVGElement;
		clone.setAttribute("width", String(squareSize));
		clone.setAttribute("height", String(squareSize));
		const xml = new XMLSerializer().serializeToString(clone);
		const dataUrl = `data:image/svg+xml;base64,${toBase64(
			new TextEncoder().encode(xml),
		)}`;

		const img = new Image();
		img.onload = () => {
			const canvas = document.createElement("canvas");
			canvas.width = squareSize;
			canvas.height = squareSize;
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			ctx.drawImage(img, 0, 0);
			canvas.toBlob((blob) => {
				if (blob) download(URL.createObjectURL(blob), "rainbow.png");
			}, "image/png");
		};
		img.src = dataUrl;
	};

	const bindSvg = (el: SVGSVGElement) => {
		svgEl = el;
	};

	return {
		colors,
		setColors,
		angle,
		setAngle,
		shapeRender,
		setShapeRender,
		rectWidth: () => geo().rectWidth,
		rectHeight: () => geo().rectHeight,
		heightSum: () => geo().heightSum,
		exportSvg,
		exportPng,
		bindSvg,
	};
}
