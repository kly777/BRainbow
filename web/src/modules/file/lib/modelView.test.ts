// ── 3D 预设视角（纯函数） ──
//
// 零向量与俯视这两个退化情况最值得钉住：前者会让相机与目标重合（画面全黑），
// 后者会让相机的"上方向"与视线平行（画面翻滚）。

import { describe, expect, it } from "vitest";
import {
	cameraPositionFor,
	normalize,
	upVectorFor,
	VIEW_DIRECTIONS,
	VIEW_PRESETS,
} from "./modelView.ts";

describe("normalize", () => {
	it("化为单位向量", () => {
		const [x, y, z] = normalize([1, 2, 1.5]);
		expect(Math.hypot(x, y, z)).toBeCloseTo(1);
	});

	it("零向量退回 +z（否则相机与目标重合，画面一片黑）", () => {
		expect(normalize([0, 0, 0])).toEqual([0, 0, 1]);
	});
});

describe("cameraPositionFor", () => {
	it("位置 = 中心 + 单位方向 × 距离", () => {
		expect(cameraPositionFor([0, 0, 0], [0, 0, 1], 10)).toEqual([0, 0, 10]);
		const pos = cameraPositionFor([1, 2, 3], [1, 0, 0], 5);
		expect(pos).toEqual([6, 2, 3]);
	});

	it("距离与方向长度无关（方向只表示朝向）", () => {
		const a = cameraPositionFor([0, 0, 0], [0, 0, 1], 10);
		const b = cameraPositionFor([0, 0, 0], [0, 0, 999], 10);
		expect(a).toEqual(b);
	});

	it("每个预设方向都给出距离正确的机位", () => {
		for (const preset of VIEW_PRESETS) {
			const pos = cameraPositionFor([0, 0, 0], VIEW_DIRECTIONS[preset], 7);
			expect(Math.hypot(...pos)).toBeCloseTo(7);
		}
	});
});

describe("upVectorFor", () => {
	it("一般角度用世界 +y", () => {
		expect(upVectorFor([1, 2, 1.5])).toEqual([0, 1, 0]);
		expect(upVectorFor([1, 0, 0])).toEqual([0, 1, 0]);
	});

	it("俯视（视线与上方向平行）改用 -z，避免画面翻滚", () => {
		expect(upVectorFor([0, 1, 0])).toEqual([0, 0, -1]);
		expect(upVectorFor([0, -1, 0])).toEqual([0, 0, -1]);
	});
});
