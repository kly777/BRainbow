import { Accessor, Setter, For } from "solid-js";
import {
  hexToRgb,
  rgbToHsl,
  hslToRgb,
  rgbToHex,
  normalizeHex,
} from "../lib/color";
import styles from "./ColorEditor.module.css";

interface Props {
  colors: Accessor<string[]>;
  setColors: Setter<string[]>;
}

/** 单个颜色行：色块预览 + HEX / RGB / HSL 输入 */
function ColorRow(props: {
  color: string;
  onColor: (hex: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const rgb = () => hexToRgb(props.color);
  const hsl = () => (rgb() ? rgbToHsl(rgb()!) : null);

  const onHexInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    if (val.length >= 7) {
      const normalized = normalizeHex(val);
      if (normalized) props.onColor(normalized);
    }
  };

  const onHexBlur = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    const normalized = normalizeHex(val);
    if (normalized) props.onColor(normalized);
  };

  const onRgbChange = (ch: "r" | "g" | "b", val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || !rgb()) return;
    const next = { ...rgb()!, [ch]: Math.max(0, Math.min(255, n)) };
    props.onColor(rgbToHex(next));
  };

  const onHslChange = (ch: "h" | "s" | "l", val: string) => {
    const n = parseInt(val, 10);
    if (isNaN(n) || !hsl()) return;
    const next = { ...hsl()! };
    if (ch === "h") next.h = ((n % 360) + 360) % 360;
    else next[ch] = Math.max(0, Math.min(100, n));
    props.onColor(rgbToHex(hslToRgb(next)));
  };

  return (
    <div class={styles.colorRow}>
      {/* 色块预览 */}
      <div class={styles.swatch} style={{ "background-color": props.color }} />

      {/* HEX */}
      <label class={styles.space}>
        <span class={styles.spaceName}>HEX</span>
        <input
          class={styles.hexInput}
          value={props.color}
          onInput={onHexInput}
          onBlur={onHexBlur}
          maxLength={7}
        />
      </label>

      {/* RGB */}
      <label class={styles.space}>
        <span class={styles.spaceName}>RGB</span>
        <span class={styles.triple}>
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="255"
            value={rgb()?.r ?? 0}
            onInput={(e) => onRgbChange("r", e.target.value)}
          />
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="255"
            value={rgb()?.g ?? 0}
            onInput={(e) => onRgbChange("g", e.target.value)}
          />
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="255"
            value={rgb()?.b ?? 0}
            onInput={(e) => onRgbChange("b", e.target.value)}
          />
        </span>
      </label>

      {/* HSL */}
      <label class={styles.space}>
        <span class={styles.spaceName}>HSL</span>
        <span class={styles.triple}>
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="360"
            value={hsl()?.h ?? 0}
            onInput={(e) => onHslChange("h", e.target.value)}
          />
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="100"
            value={hsl()?.s ?? 0}
            onInput={(e) => onHslChange("s", e.target.value)}
          />
          <input
            class={styles.channel}
            type="number"
            min="0"
            max="100"
            value={hsl()?.l ?? 0}
            onInput={(e) => onHslChange("l", e.target.value)}
          />
        </span>
      </label>

      {/* 删除 */}
      <button
        class={styles.removeBtn}
        onClick={props.onRemove}
        disabled={!props.canRemove}
        title="删除此颜色"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * 颜色编辑器 —— 多色彩空间 + 增删
 *
 * 每行展示 HEX / RGB / HSL 三个空间，任意空间修改都
 * 实时同步到其余空间并写回 colors 信号。
 */
export default function ColorEditor(props: Props) {
  const addColor = () => {
    // 插入一个与最后一个颜色相近的随机色
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
        <For each={props.colors()}>
          {(color, idx) => (
            <ColorRow
              color={color}
              onColor={(hex) => updateColor(idx(), hex)}
              onRemove={() => removeColor(idx())}
              canRemove={props.colors().length > 1}
            />
          )}
        </For>
      </div>
      <button class={styles.addBtn} onClick={addColor}>
        ＋ 添加颜色
      </button>
    </fieldset>
  );
}

/** 生成柔和随机色（HEX） */
function randomPastel(): string {
  const h = Math.floor(Math.random() * 360);
  return rgbToHex(hslToRgb({ h, s: 60, l: 65 }));
}
