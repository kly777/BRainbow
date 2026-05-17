import { createSignal, createEffect, Accessor, Setter, Index } from "solid-js";
import {
  hexToRgb,
  rgbToHsl,
  hslToRgb,
  rgbToHex,
  normalizeHex,
} from "../lib/color.ts";
import styles from "./ColorEditor.module.css";

type ColorSpace = "hex" | "rgb" | "hsl";

interface Props {
  colors: Accessor<string[]>;
  setColors: Setter<string[]>;
}

const SPACES: { key: ColorSpace; label: string }[] = [
  { key: "hex", label: "HEX" },
  { key: "rgb", label: "RGB" },
  { key: "hsl", label: "HSL" },
];

/** 单个颜色行 */
function ColorRow(props: {
  color: string;
  onColor: (hex: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const [space, setSpace] = createSignal<ColorSpace>("hex");
  let focused = false;

  // ── 本地缓冲（所有空间同时持有，切换时无需重新推导） ──
  const initRgb = () => hexToRgb(props.color) ?? { r: 0, g: 0, b: 0 };
  const initHsl = () => {
    const r = hexToRgb(props.color);
    return r ? rgbToHsl(r) : { h: 0, s: 0, l: 0 };
  };

  const [hex, setHex] = createSignal(props.color);
  const [r, setR] = createSignal(initRgb().r);
  const [g, setG] = createSignal(initRgb().g);
  const [b, setB] = createSignal(initRgb().b);
  const [h, setH] = createSignal(initHsl().h);
  const [s, setS] = createSignal(initHsl().s);
  const [l, setL] = createSignal(initHsl().l);

  // ── 外部变化时同步（仅在失焦时） ──
  createEffect(() => {
    space();        // 订阅模式切换
    props.color;    // 订阅外部颜色变化
    if (focused) return;

    setHex(props.color);
    const rgb = hexToRgb(props.color) ?? { r: 0, g: 0, b: 0 };
    setR(rgb.r);
    setG(rgb.g);
    setB(rgb.b);
    const hsl = rgbToHsl(rgb);
    setH(hsl.h);
    setS(hsl.s);
    setL(hsl.l);
  });

  // ── 提交 ──
  const commitHex = (val: string) => {
    const n = normalizeHex(val);
    if (n) props.onColor(n);
  };
  const commitRgb = (nr: number, ng: number, nb: number) => {
    props.onColor(rgbToHex({
      r: Math.max(0, Math.min(255, nr)),
      g: Math.max(0, Math.min(255, ng)),
      b: Math.max(0, Math.min(255, nb)),
    }));
  };
  const commitHsl = (nh: number, ns: number, nl: number) => {
    props.onColor(rgbToHex(hslToRgb({
      h: ((nh % 360) + 360) % 360,
      s: Math.max(0, Math.min(100, ns)),
      l: Math.max(0, Math.min(100, nl)),
    })));
  };

  // ── 事件处理 ──
  const onHexInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    setHex(val);
    commitHex(val);
  };

  const onRgbInput = (ch: "r" | "g" | "b", e: Event) => {
    const n = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(n)) return;
    if (ch === "r") setR(n); else if (ch === "g") setG(n); else setB(n);
    commitRgb(ch === "r" ? n : r(), ch === "g" ? n : g(), ch === "b" ? n : b());
  };

  const onHslInput = (ch: "h" | "s" | "l", e: Event) => {
    const n = parseInt((e.target as HTMLInputElement).value, 10);
    if (isNaN(n)) return;
    if (ch === "h") setH(n); else if (ch === "s") setS(n); else setL(n);
    commitHsl(ch === "h" ? n : h(), ch === "s" ? n : s(), ch === "l" ? n : l());
  };

  const onFocus = () => { focused = true; };
  const onBlur = () => { focused = false; };

  return (
    <div class={styles.colorRow}>
      <div class={styles.swatch} style={{ "background-color": props.color }} />

      <div class={styles.segmented}>
        {SPACES.map((sp) => (
          <button
            class={space() === sp.key ? styles.segActive : styles.segBtn}
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
        <span class={styles.triple}>
          <input class={styles.channel} type="number" min="0" max="255"
            value={r()} onInput={(e) => onRgbInput("r", e)} onFocus={onFocus} onBlur={onBlur} />
          <input class={styles.channel} type="number" min="0" max="255"
            value={g()} onInput={(e) => onRgbInput("g", e)} onFocus={onFocus} onBlur={onBlur} />
          <input class={styles.channel} type="number" min="0" max="255"
            value={b()} onInput={(e) => onRgbInput("b", e)} onFocus={onFocus} onBlur={onBlur} />
        </span>
      )}
      {space() === "hsl" && (
        <span class={styles.triple}>
          <input class={styles.channel} type="number" min="0" max="360"
            value={h()} onInput={(e) => onHslInput("h", e)} onFocus={onFocus} onBlur={onBlur} />
          <input class={styles.channel} type="number" min="0" max="100"
            value={s()} onInput={(e) => onHslInput("s", e)} onFocus={onFocus} onBlur={onBlur} />
          <input class={styles.channel} type="number" min="0" max="100"
            value={l()} onInput={(e) => onHslInput("l", e)} onFocus={onFocus} onBlur={onBlur} />
        </span>
      )}

      <button
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

export default function ColorEditor(props: Props) {
  const addColor = () => {
    props.setColors((prev) => [...prev, randomPastel()]);
  };

  const updateColor = (idx: number, hex: string) => {
    props.setColors((prev) => prev.map((c, i) => (i === idx ? hex : c)));
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
              onColor={(hex) => updateColor(idx, hex)}
              onRemove={() => removeColor(idx)}
              canRemove={props.colors().length > 1}
            />
          )}
        </Index>
      </div>
      <button class={styles.addBtn} onClick={addColor}>
        ＋ 添加颜色
      </button>
    </fieldset>
  );
}

function randomPastel(): string {
  const h = Math.floor(Math.random() * 360);
  return rgbToHex(hslToRgb({ h, s: 60, l: 65 }));
}
