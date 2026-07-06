import { describe, it, expect } from "vitest";
import { Angle } from "./angle.ts";

describe("Angle", () => {
  // ── fromDegree → degree roundtrip ──

  it("0° roundtrip", () => {
    const a = Angle.fromDegree(0);
    expect(a.degree).toBeCloseTo(0);
    expect(a.radian).toBeCloseTo(0);
  });

  it("90° roundtrip", () => {
    const a = Angle.fromDegree(90);
    expect(a.degree).toBeCloseTo(90);
    expect(a.radian).toBeCloseTo(Math.PI / 2);
  });

  it("180° roundtrip", () => {
    const a = Angle.fromDegree(180);
    expect(a.degree).toBeCloseTo(180);
    expect(a.radian).toBeCloseTo(Math.PI);
  });

  it("360° roundtrip", () => {
    const a = Angle.fromDegree(360);
    expect(a.degree).toBeCloseTo(360);
    expect(a.radian).toBeCloseTo(2 * Math.PI);
  });

  it("-90° roundtrip", () => {
    const a = Angle.fromDegree(-90);
    expect(a.degree).toBeCloseTo(-90);
    expect(a.radian).toBeCloseTo(-Math.PI / 2);
  });

  it("45° = π/4 rad", () => {
    const a = Angle.fromDegree(45);
    expect(a.radian).toBeCloseTo(Math.PI / 4);
  });

  it("360° == 0° in rad", () => {
    const a = Angle.fromDegree(360);
    const b = Angle.fromDegree(0);
    expect(a.radian).toBeCloseTo(b.radian + 2 * Math.PI);
  });

  // ── fromSlope ──

  it("0% slope = 0°", () => {
    const a = Angle.fromSlope(0);
    expect(a.degree).toBeCloseTo(0);
  });

  it("100% slope = 45°", () => {
    const a = Angle.fromSlope(100);
    expect(a.degree).toBeCloseTo(45);
  });

  it("50% slope ≈ 26.565°", () => {
    const a = Angle.fromSlope(50);
    expect(a.degree).toBeCloseTo(26.565, 1);
  });

  it("-100% slope = -45°", () => {
    const a = Angle.fromSlope(-100);
    expect(a.degree).toBeCloseTo(-45);
  });

  // ── constructor from radian ──

  it("constructor takes radian directly", () => {
    const a = new Angle(Math.PI / 2);
    expect(a.degree).toBeCloseTo(90);
    expect(a.radian).toBeCloseTo(Math.PI / 2);
  });

  it("does not mutate after construction", () => {
    const rad = 1.234;
    const a = new Angle(rad);
    expect(a.radian).toBe(1.234);
    expect(a.degree).toBeCloseTo((1.234 * 180) / Math.PI);
  });
});
