import { describe, it, expect } from "vitest";
import { buildSvg } from "./icon";
import { Angle } from "./angle";

// ── SVG 结构 ──

describe("buildSvg", () => {
	it("produces valid SVG string", () => {
		const colors = ["#ff0000", "#00ff00", "#0000ff"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		expect(svg).toContain("<svg");
		expect(svg).toContain("</svg>");
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	it("includes correct number of polygons", () => {
		const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		const polygonCount = (svg.match(/<polygon /g) || []).length;
		expect(polygonCount).toBe(5);
	});

	it("respects size parameter in viewBox", () => {
		const colors = ["#ff0000"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 128);
		expect(svg).toContain('width="128"');
		expect(svg).toContain('height="128"');
		expect(svg).toContain('viewBox="0 0 128 128"');
	});

	it("contains correct colors", () => {
		const colors = ["#ff0000", "#00ff00"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		expect(svg).toContain('fill="#ff0000"');
		expect(svg).toContain('fill="#00ff00"');
	});

	it("polygons have valid points attribute", () => {
		const colors = ["#ff0000"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		// Points should contain comma-separated numbers
		const match = svg.match(/points="([^"]+)"/);
		expect(match).not.toBeNull();
		const points = match![1];
		// Should have 4 x,y pairs
		const pairs = points.split(" ").filter(Boolean);
		expect(pairs.length).toBe(4);
	});

	it("single color produces one polygon", () => {
		const colors = ["#ff0000"];
		const svg = buildSvg(colors, Angle.fromDegree(45), 64);
		const polygonCount = (svg.match(/<polygon /g) || []).length;
		expect(polygonCount).toBe(1);
	});

	it("angle 0 produces horizontal-ish polygons", () => {
		const colors = ["#ff0000", "#00ff00"];
		const svg0 = buildSvg(colors, Angle.fromDegree(0), 64);
		const svg90 = buildSvg(colors, Angle.fromDegree(90), 64);
		// Different angles → different output
		expect(svg0).not.toBe(svg90);
	});

	it("does not contain empty fill", () => {
		const colors = ["#ff0000"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		expect(svg).not.toContain('fill=""');
	});

	it("has geometricPrecision shape-rendering", () => {
		const colors = ["#ff0000"];
		const svg = buildSvg(colors, Angle.fromDegree(30), 64);
		expect(svg).toContain('shape-rendering="geometricPrecision"');
	});
});
