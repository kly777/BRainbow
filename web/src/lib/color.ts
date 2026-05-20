import { Effect } from "effect";

/**
 * 颜色类 — 内部以 CIE XYZ 存储。
 * 可能失败的操作（如 parse hex）返回 Effect，不抛异常。
 *
 *   输入/输出        中转层          内部存储
 *   ─────────────────────────────────────────────
 *   Hex  ←→  sRGB  ←→  Linear sRGB  ←→  XYZ
 *   HSL  ←→  sRGB
 *   OKLCH ←→ OKLAB ←────────────────────  XYZ
 */

export interface Rgb {
    r: number;
    g: number;
    b: number;
}

export interface Hsl {
    h: number;
    s: number;
    l: number;
}

export interface Xyz {
    x: number;
    y: number;
    z: number;
}

export interface Oklab {
    L: number;
    a: number;
    b: number;
}

export interface Oklch {
    L: number;
    C: number;
    h: number;
}

export class Color {
    readonly x: number;
    readonly y: number;
    readonly z: number;

    private constructor(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    // ── 工厂 ──

    static fromXyz(xyz: Xyz): Color {
        return new Color(xyz.x, xyz.y, xyz.z);
    }

    static fromLinearRgb(lr: number, lg: number, lb: number): Color {
        const x = 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb;
        const y = 0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb;
        const z = 0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb;
        return new Color(x, y, z);
    }

    static fromRgb(rgb: Rgb): Color {
        return Color.fromLinearRgb(
            Color.#gammaExpand(rgb.r / 255),
            Color.#gammaExpand(rgb.g / 255),
            Color.#gammaExpand(rgb.b / 255),
        );
    }

    static fromHex(hex: string): Effect.Effect<Color, Error> {
        return Effect.try({
            try: () => Color.#parseHex(hex),
            catch: (e) =>
                e instanceof Error ? e : new Error(`无效的 hex: ${hex}`),
        });
    }

    static fromHsl(hsl: Hsl): Color {
        return Color.fromRgb(Color.#hslToRgb(hsl));
    }

    static fromOklab(ok: Oklab): Color {
        const l_ = ok.L + 0.3963377774 * ok.a + 0.2158037573 * ok.b;
        const m_ = ok.L - 0.1055613458 * ok.a - 0.0638541728 * ok.b;
        const s_ = ok.L - 0.0894841775 * ok.a - 1.2914855480 * ok.b;
        const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
        return Color.fromLinearRgb(
            4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
            -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
            -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
        );
    }

    static fromOklch(lch: Oklch): Color {
        return Color.fromOklab({
            L: lch.L,
            a: lch.C * Math.cos((lch.h * Math.PI) / 180),
            b: lch.C * Math.sin((lch.h * Math.PI) / 180),
        });
    }

    // ── 提取 ──

    toXyz(): Xyz {
        return { x: this.x, y: this.y, z: this.z };
    }

    toLinearRgb(): { r: number; g: number; b: number } {
        const { x, y, z } = this;
        return {
            r: 3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
            g: -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
            b: 0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
        };
    }

    toRgb(): Rgb {
        const lr = this.toLinearRgb();
        return {
            r: Color.#clamp(Color.#gammaCompress(lr.r) * 255),
            g: Color.#clamp(Color.#gammaCompress(lr.g) * 255),
            b: Color.#clamp(Color.#gammaCompress(lr.b) * 255),
        };
    }

    toHex(): string {
        const rgb = this.toRgb();
        const h = (n: number) => Color.#clamp(n).toString(16).padStart(2, "0");
        return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
    }

    toHsl(): Hsl {
        return Color.#rgbToHsl(this.toRgb());
    }

    toOklab(): Oklab {
        const lr = this.toLinearRgb();
        const l = 0.4122214708 * lr.r + 0.5363325363 * lr.g +
            0.0514459929 * lr.b;
        const m = 0.2119034982 * lr.r + 0.6806995451 * lr.g +
            0.1073969566 * lr.b;
        const s = 0.0883024619 * lr.r + 0.2817188376 * lr.g +
            0.6299787005 * lr.b;
        return {
            L: 0.2104542553 * Math.cbrt(l) + 0.7936177850 * Math.cbrt(m) -
                0.0040720468 * Math.cbrt(s),
            a: 1.9779984951 * Math.cbrt(l) - 2.4285922050 * Math.cbrt(m) +
                0.4505937099 * Math.cbrt(s),
            b: 0.0259040371 * Math.cbrt(l) + 0.7827717662 * Math.cbrt(m) -
                0.8086757660 * Math.cbrt(s),
        };
    }

    toOklch(): Oklch {
        const ok = this.toOklab();
        const C = Math.sqrt(ok.a ** 2 + ok.b ** 2);
        const h = ((Math.atan2(ok.b, ok.a) * 180) / Math.PI + 360) % 360;
        return { L: ok.L, C, h };
    }

    // ── 不可变更新 ──

    withRgb(rgb: Partial<Rgb>): Color {
        return Color.fromRgb({ ...this.toRgb(), ...rgb });
    }

    withHsl(hsl: Partial<Hsl>): Color {
        return Color.fromHsl({ ...this.toHsl(), ...hsl });
    }

    withOklch(lch: Partial<Oklch>): Color {
        return Color.fromOklch({ ...this.toOklch(), ...lch });
    }

    equals(other: Color): boolean {
        return this.toHex() === other.toHex();
    }

    toString(): string {
        return this.toHex();
    }

    // ═══════════════════════════════
    // 私有
    // ═══════════════════════════════

    static #parseHex(hex: string): Color {
        const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        if (!m) throw new Error(`无效的 hex: ${hex}`);
        return Color.fromRgb({
            r: parseInt(m[1], 16),
            g: parseInt(m[2], 16),
            b: parseInt(m[3], 16),
        });
    }

    static #clamp(n: number): number {
        return Math.max(0, Math.min(255, Math.round(n)));
    }

    static #gammaExpand(c: number): number {
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }

    static #gammaCompress(c: number): number {
        return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
    }

    static #hue2rgb(p: number, q: number, t: number): number {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    }

    static #hslToRgb(hsl: Hsl): Rgb {
        const h = hsl.h / 360, s = hsl.s / 100, l = hsl.l / 100;
        if (s === 0) {
            const v = Math.round(l * 255);
            return { r: v, g: v, b: v };
        }
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return {
            r: Math.round(Color.#hue2rgb(p, q, h + 1 / 3) * 255),
            g: Math.round(Color.#hue2rgb(p, q, h) * 255),
            b: Math.round(Color.#hue2rgb(p, q, h - 1 / 3) * 255),
        };
    }

    static #rgbToHsl(rgb: Rgb): Hsl {
        const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d !== 0) {
            if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            else if (max === g) h = ((b - r) / d + 2) / 6;
            else h = ((r - g) / d + 4) / 6;
        }
        const l = (max + min) / 2;
        const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
        return {
            h: Math.round(h * 360),
            s: Math.round(s * 100),
            l: Math.round(l * 100),
        };
    }
}
