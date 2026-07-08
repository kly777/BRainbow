import { describe, it, expect } from "vitest";
import { Color } from "./color.ts";

// ═══════════════════════════════════════════════
// 已知颜色参考值
// ═══════════════════════════════════════════════

const COLORS = {
  red: { hex: "#ff0000", rgb: { r: 255, g: 0, b: 0 }, hsl: { h: 0, s: 100, l: 50 } },
  green: { hex: "#00ff00", rgb: { r: 0, g: 255, b: 0 }, hsl: { h: 120, s: 100, l: 50 } },
  blue: { hex: "#0000ff", rgb: { r: 0, g: 0, b: 255 }, hsl: { h: 240, s: 100, l: 50 } },
  white: { hex: "#ffffff", rgb: { r: 255, g: 255, b: 255 }, hsl: { h: 0, s: 0, l: 100 } },
  black: { hex: "#000000", rgb: { r: 0, g: 0, b: 0 }, hsl: { h: 0, s: 0, l: 0 } },
  gray: { hex: "#808080", rgb: { r: 128, g: 128, b: 128 }, hsl: { h: 0, s: 0, l: 50 } },
  purple: { hex: "#800080", rgb: { r: 128, g: 0, b: 128 }, hsl: { h: 300, s: 100, l: 25 } },
  orange: { hex: "#ffa500", rgb: { r: 255, g: 165, b: 0 }, hsl: { h: 39, s: 100, l: 50 } },
} as const;

// ═══════════════════════════════════════════════
// fromHex / toHex roundtrip
// ═══════════════════════════════════════════════

describe("hex roundtrip", () => {
  for (const [name, c] of Object.entries(COLORS)) {
    it(`${name}: fromHex → toHex === ${c.hex}`, () => {
      const color = Color.fromHex(c.hex);
      expect(color).not.toBeNull();
      expect(color?.toHex()).toBe(c.hex);
    });
  }

  it("fromHex with # is optional", () => {
    const withHash = Color.fromHex("#ff0000");
    const withoutHash = Color.fromHex("ff0000");
    expect(withHash?.toHex()).toBe(withoutHash?.toHex());
  });

  it("fromHex returns null for invalid hex", () => {
    expect(Color.fromHex("not-a-color")).toBeNull();
  });

  it("fromHex returns null for short hex", () => {
    expect(Color.fromHex("#fff")).toBeNull();
  });

  it("fromHex returns null for empty string", () => {
    expect(Color.fromHex("")).toBeNull();
  });

  it("fromHex is case insensitive", () => {
    expect(Color.fromHex("#FF0000")?.toHex()).toBe("#ff0000");
    expect(Color.fromHex("#Ff0000")?.toHex()).toBe("#ff0000");
  });
});

// ═══════════════════════════════════════════════
// fromRgb / toRgb roundtrip
// ═══════════════════════════════════════════════

describe("rgb roundtrip", () => {
  for (const [name, c] of Object.entries(COLORS)) {
    it(`${name}: fromRgb → toRgb === ${JSON.stringify(c.rgb)}`, () => {
      const color = Color.fromRgb(c.rgb);
      const result = color.toRgb();
      expect(result).toEqual(c.rgb);
    });
  }

  it("roundtrip exact integer values", () => {
    // Test a range of values
    for (const r of [0, 128, 255]) {
      for (const g of [0, 128, 255]) {
        for (const b of [0, 128, 255]) {
          const color = Color.fromRgb({ r, g, b });
          const result = color.toRgb();
          expect(result).toEqual({ r, g, b });
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════
// fromHsl / toHsl roundtrip (approximate)
// ═══════════════════════════════════════════════

describe("hsl roundtrip", () => {
  function hslMatches(name: string, hsl: { h: number; s: number; l: number }, expectedRgb: { r: number; g: number; b: number }) {
    it(`${name}: fromHsl → RGB match`, () => {
      const color = Color.fromHsl(hsl);
      const rgb = color.toRgb();
      // HSL → RGB may differ by ±1 due to floating-point rounding
      const diff = (a: number, b: number) => Math.abs(a - b);
      expect(diff(rgb.r, expectedRgb.r)).toBeLessThanOrEqual(1);
      expect(diff(rgb.g, expectedRgb.g)).toBeLessThanOrEqual(1);
      expect(diff(rgb.b, expectedRgb.b)).toBeLessThanOrEqual(1);
    });
  }

  for (const [name, c] of Object.entries(COLORS)) {
    hslMatches(name, c.hsl, c.rgb);
  }

  it("HSL → RGB → HSL roundtrip", () => {
    const hsls = [
      { h: 0, s: 100, l: 50 },
      { h: 180, s: 50, l: 50 },
      { h: 45, s: 75, l: 30 },
      { h: 300, s: 25, l: 70 },
    ];
    for (const hsl of hsls) {
      const color = Color.fromHsl(hsl);
      const result = color.toHsl();
      expect(result.h).toBeCloseTo(hsl.h, -0.5);
      expect(result.s).toBeCloseTo(hsl.s, -0.5);
      expect(result.l).toBeCloseTo(hsl.l, -0.5);
    }
  });
});

// ═══════════════════════════════════════════════
// Oklab / Oklch roundtrip
// ═══════════════════════════════════════════════

describe("oklch roundtrip", () => {
  for (const [name, c] of Object.entries(COLORS)) {
    it(`${name}: fromOklch → toHex === ${c.hex}`, () => {
      // via RGB: rgb → oklch → rgb back
      const original = Color.fromRgb(c.rgb);
      const lch = original.toOklch();
      const restored = Color.fromOklch(lch);
      expect(restored.toHex()).toBe(c.hex);
    });
  }

  it("fromOklab → toOklab roundtrip", () => {
    const original = Color.fromRgb({ r: 75, g: 130, b: 200 });
    const lab = original.toOklab();
    const restored = Color.fromOklab(lab);
    expect(original.toHex()).toBe(restored.toHex());
  });

  it("Oklch L C h values are in expected ranges", () => {
    const color = Color.fromRgb({ r: 100, g: 150, b: 200 });
    const lch = color.toOklch();
    expect(lch.L).toBeGreaterThan(0);
    expect(lch.C).toBeGreaterThan(0);
    expect(lch.h).toBeGreaterThanOrEqual(0);
    expect(lch.h).toBeLessThan(360);
  });
});

// ═══════════════════════════════════════════════
// XYZ roundtrip
// ═══════════════════════════════════════════════

describe("xyz roundtrip", () => {
  for (const [name, c] of Object.entries(COLORS)) {
    it(`${name}: fromXyz → toXyz roundtrip`, () => {
      const original = Color.fromRgb(c.rgb);
      const xyz = original.toXyz();
      const restored = Color.fromXyz(xyz);
      expect(restored.toHex()).toBe(c.hex);
    });
  }
});

// ═══════════════════════════════════════════════
// equals
// ═══════════════════════════════════════════════

describe("equals", () => {
  it("same hex colors are equal", () => {
    const a = Color.fromHex("#ff0000")!;
    const b = Color.fromHex("#ff0000")!;
    expect(a.equals(b)).toBe(true);
  });

  it("different hex colors are not equal", () => {
    const a = Color.fromHex("#ff0000")!;
    const b = Color.fromHex("#00ff00")!;
    expect(a.equals(b)).toBe(false);
  });

  it("same color via different paths are equal", () => {
    const a = Color.fromRgb({ r: 128, g: 128, b: 128 });
    const b = Color.fromHsl({ h: 0, s: 0, l: 50 });
    expect(a.equals(b)).toBe(true);
  });
});

// ═══════════════════════════════════════════════
// withRgb / withHsl / withOklch (immutable updates)
// ═══════════════════════════════════════════════

describe("immutable updates", () => {
  it("withRgb does not mutate original", () => {
    const original = Color.fromHex("#ff0000")!;
    const modified = original.withRgb({ g: 255 });
    expect(original.toHex()).toBe("#ff0000");
    expect(modified.toHex()).toBe("#ffff00");
  });

  it("withHsl does not mutate original", () => {
    const original = Color.fromHex("#ff0000")!;
    const modified = original.withHsl({ h: 240 });
    expect(original.toHex()).toBe("#ff0000");
    expect(modified.toHex()).toBe("#0000ff");
  });

  it("withOklch does not mutate original", () => {
    const original = Color.fromHex("#ff0000")!;
    const lch = original.toOklch();
    const modified = original.withOklch({ L: lch.L * 0.5 });
    expect(modified.toHex()).not.toBe("#ff0000");
    expect(original.toHex()).toBe("#ff0000");
  });

  it("withRgb partial field only changes that field", () => {
    const original = Color.fromRgb({ r: 100, g: 100, b: 100 });
    const modified = original.withRgb({ r: 200 });
    const rgb = modified.toRgb();
    expect(rgb.r).toBe(200);
    expect(rgb.g).toBe(100);
    expect(rgb.b).toBe(100);
  });
});

// ═══════════════════════════════════════════════
// toString
// ═══════════════════════════════════════════════

describe("toString", () => {
  it("returns hex value", () => {
    const color = Color.fromHex("#336699")!;
    expect(color.toString()).toBe("#336699");
  });
});
