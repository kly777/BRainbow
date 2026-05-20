import {
    type Accessor,
    createEffect,
    createSignal,
    Index,
    type Setter,
} from "solid-js";
import { Effect, Exit } from "effect";
import { Color } from "../lib/color.ts";
import styles from "./ColorEditor.module.css";

type ColorSpace = "hex" | "rgb" | "hsl" | "oklch";

interface Props {
    colors: Accessor<Color[]>;
    setColors: Setter<Color[]>;
}

const SPACES: { key: ColorSpace; label: string }[] = [
    { key: "hex", label: "HEX" },
    { key: "rgb", label: "RGB" },
    { key: "hsl", label: "HSL" },
    { key: "oklch", label: "OKLCH" },
];

// ═══════════════════════════════════════════
// ColorRow — 单色编辑行
// ═══════════════════════════════════════════

function ColorRow(props: {
    color: Color;
    onColor: (c: Color) => void;
    onRemove: () => void;
    canRemove: boolean;
}) {
    const [space, setSpace] = createSignal<ColorSpace>("hex");
    let focused = false;

    // ── 本地缓冲（所有空间同时持有，切换时无需重新推导） ──
    const initRgb = () => props.color.toRgb();
    const initHsl = () => props.color.toHsl();
    const initOklch = () => props.color.toOklch();

    const [hex, setHex] = createSignal(props.color.toHex());
    const [r, setR] = createSignal(initRgb().r);
    const [g, setG] = createSignal(initRgb().g);
    const [b, setB] = createSignal(initRgb().b);
    const [h, setH] = createSignal(initHsl().h);
    const [s, setS] = createSignal(initHsl().s);
    const [l, setL] = createSignal(initHsl().l);
    const [okL, setOkL] = createSignal(initOklch().L);
    const [okC, setOkC] = createSignal(initOklch().C);
    const [okH, setOkH] = createSignal(initOklch().h);

    // ── 外部变化时同步（仅在失焦时） ──
    createEffect(() => {
        space();
        props.color;
        if (focused) return;

        const c = props.color;
        setHex(c.toHex());
        const rgb = c.toRgb();
        setR(rgb.r);
        setG(rgb.g);
        setB(rgb.b);
        const hsl = c.toHsl();
        setH(hsl.h);
        setS(hsl.s);
        setL(hsl.l);
        const lch = c.toOklch();
        setOkL(lch.L);
        setOkC(lch.C);
        setOkH(lch.h);
    });

    // ── 提交 ──
    const commit = (c: Color) => props.onColor(c);

    const onHexInput = (e: Event) => {
        const val = (e.target as HTMLInputElement).value;
        setHex(val);
        const exit = Effect.runSyncExit(Color.fromHex(val));
        if (Exit.isSuccess(exit)) commit(exit.value);
    };

    const onRgbInput = (ch: "r" | "g" | "b", e: Event) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10);
        if (Number.isNaN(n)) return;
        if (ch === "r") setR(n);
        else if (ch === "g") setG(n);
        else setB(n);
        commit(Color.fromRgb({ r: r(), g: g(), b: b() }));
    };

    const onHslInput = (ch: "h" | "s" | "l", e: Event) => {
        const n = parseInt((e.target as HTMLInputElement).value, 10);
        if (Number.isNaN(n)) return;
        if (ch === "h") setH(((n % 360) + 360) % 360);
        else if (ch === "s") setS(Math.max(0, Math.min(100, n)));
        else setL(Math.max(0, Math.min(100, n)));
        commit(Color.fromHsl({ h: h(), s: s(), l: l() }));
    };

    const onOklchInput = (ch: "L" | "C" | "h", e: Event) => {
        const n = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isNaN(n)) return;
        if (ch === "L") setOkL(Math.max(0, Math.min(1, n)));
        else if (ch === "C") setOkC(Math.max(0, n));
        else setOkH(((n % 360) + 360) % 360);
        commit(Color.fromOklch({ L: okL(), C: okC(), h: okH() }));
    };

    const onFocus = () => {
        focused = true;
    };
    const onBlur = () => {
        focused = false;
    };

    return (
        <div class={styles.colorRow}>
            <div
                class={styles.swatch}
                style={{ "background-color": props.color.toHex() }}
            />

            <div class={styles.segmented}>
                {SPACES.map((sp) => (
                    <button
                        type="button"
                        class={space() === sp.key
                            ? styles.segActive
                            : styles.segBtn}
                        onClick={() => setSpace(sp.key)}
                    >
                        {sp.label}
                    </button>
                ))}
            </div>

            {space() === "hex" && (
                <input
                    class={styles.hexInput}
                    value={hex()}
                    onInput={onHexInput}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    maxLength={7}
                />
            )}
            {space() === "rgb" && (
                <RgbInputs
                    r={r}
                    g={g}
                    b={b}
                    onInput={onRgbInput}
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            )}
            {space() === "hsl" && (
                <HslInputs
                    h={h}
                    s={s}
                    l={l}
                    onInput={onHslInput}
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            )}
            {space() === "oklch" && (
                <OklchInputs
                    L={okL}
                    C={okC}
                    h={okH}
                    onInput={onOklchInput}
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            )}

            <button
                type="button"
                class={styles.removeBtn}
                onClick={props.onRemove}
                disabled={!props.canRemove}
                title="删除"
            >
                ✕
            </button>
        </div>
    );
}

// ── 输入行组件 ──

function RgbInputs(props: {
    r: Accessor<number>;
    g: Accessor<number>;
    b: Accessor<number>;
    onInput: (ch: "r" | "g" | "b", e: Event) => void;
    onFocus: () => void;
    onBlur: () => void;
}) {
    return (
        <span class={styles.triple}>
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="255"
                value={props.r()}
                onInput={(e) => props.onInput("r", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="255"
                value={props.g()}
                onInput={(e) => props.onInput("g", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="255"
                value={props.b()}
                onInput={(e) => props.onInput("b", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <span class={styles.rangeHint}>0–255</span>
        </span>
    );
}

function HslInputs(props: {
    h: Accessor<number>;
    s: Accessor<number>;
    l: Accessor<number>;
    onInput: (ch: "h" | "s" | "l", e: Event) => void;
    onFocus: () => void;
    onBlur: () => void;
}) {
    return (
        <span class={styles.triple}>
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="360"
                value={props.h()}
                onInput={(e) => props.onInput("h", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="100"
                value={props.s()}
                onInput={(e) => props.onInput("s", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="100"
                value={props.l()}
                onInput={(e) => props.onInput("l", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <span class={styles.rangeHint}>H:0–360 S/L:0–100</span>
        </span>
    );
}

function OklchInputs(props: {
    L: Accessor<number>;
    C: Accessor<number>;
    h: Accessor<number>;
    onInput: (ch: "L" | "C" | "h", e: Event) => void;
    onFocus: () => void;
    onBlur: () => void;
}) {
    return (
        <span class={styles.triple}>
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="1"
                step="0.001"
                value={props.L()}
                onInput={(e) => props.onInput("L", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                step="0.001"
                value={props.C()}
                onInput={(e) => props.onInput("C", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <input
                class={styles.channel}
                type="number"
                min="0"
                max="360"
                step="0.1"
                value={props.h()}
                onInput={(e) => props.onInput("h", e)}
                onFocus={props.onFocus}
                onBlur={props.onBlur}
            />
            <span class={styles.rangeHint}>L:0–1 C:≥0 h:0–360</span>
        </span>
    );
}

// ═══════════════════════════════════════════
// ColorEditor — 主组件
// ═══════════════════════════════════════════

export default function ColorEditor(props: Props) {
    const addColor = () => {
        const h = Math.random() * 360;
        props.setColors((prev) => [
            ...prev,
            Color.fromOklch({ L: 0.65, C: 0.15, h }),
        ]);
    };

    const updateColor = (idx: number, c: Color) => {
        props.setColors((prev) => prev.map((col, i) => (i === idx ? c : col)));
    };

    const removeColor = (idx: number) => {
        props.setColors((prev) => prev.filter((_, i) => i !== idx));
    };

    return (
        <fieldset class={styles.fieldset}>
            <legend>颜色 / Colors</legend>
            <div class={styles.list}>
                <Index each={props.colors()}>
                    {(color, idx) => (
                        <ColorRow
                            color={color()}
                            onColor={(c) => updateColor(idx, c)}
                            onRemove={() => removeColor(idx)}
                            canRemove={props.colors().length > 1}
                        />
                    )}
                </Index>
            </div>
            <button type="button" class={styles.addBtn} onClick={addColor}>
                ＋ 添加颜色
            </button>
        </fieldset>
    );
}
