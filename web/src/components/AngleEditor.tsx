import { createSignal, createEffect, type Accessor, type Setter } from "solid-js";
import { Angle } from "../lib/angle.ts";
import styles from "./AngleEditor.module.css";

type AngleMode = "deg" | "rad" | "slope";

interface Props {
  angle: Accessor<Angle>;
  setAngle: Setter<Angle>;
}

function decompose(a: Angle) {
  return {
    deg: a.degree.toFixed(2),
    rad: a.radian.toFixed(4),
    slope: (Math.tan(a.radian) * 100).toFixed(2),
  };
}

const MODES: { key: AngleMode; label: string; unit: string }[] = [
  { key: "deg", label: "度数", unit: "°" },
  { key: "rad", label: "弧度", unit: "rad" },
  { key: "slope", label: "坡度", unit: "%" },
];

/** 把字符串解析后写入 angle，无法解析则忽略 */
function commit(raw: string, mode: AngleMode, setAngle: Setter<Angle>) {
  const v = parseFloat(raw);
  if (Number.isNaN(v)) {
      setAngle(new Angle(0));
      return;
  };
  switch (mode) {
    case "deg":  setAngle(Angle.fromDegree(v)); break;
    case "rad":  setAngle(new Angle(v)); break;
    case "slope": setAngle(Angle.fromSlope(v)); break;
  }
}

/**
 * 角度编辑器
 */
export default function AngleEditor(props: Props) {
  const [mode, setMode] = createSignal<AngleMode>("deg");
  const [local, setLocal] = createSignal(decompose(props.angle())[mode()]);
  let focused = false;

  // 模式切换 / 外部 angle 变化 → 失焦时同步到本地缓冲
  createEffect(() => {
    const m = mode();
    props.angle(); // 订阅
    if (!focused) setLocal(decompose(props.angle())[m]);
  });

  const onInput = (e: Event) => {
    setLocal((e.target as HTMLInputElement).value);
        commit(local(), mode(), props.setAngle);
  };

  const onBlur = () => {
    focused = false;
    commit(local(), mode(), props.setAngle);
  };

  const onFocus = () => {
    focused = true;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <fieldset class={styles.fieldset}>
      <legend>角度 / Angle</legend>

      <div class={styles.segmented}>
        {MODES.map((m) => (
          <button
            type="button"
            class={mode() === m.key ? styles.segActive : styles.segBtn}
            onClick={() => setMode(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <label class={styles.inputRow}>
        <input
          type="text"
          inputmode="decimal"
          value={local()}
          onInput={onInput}
          onFocus={onFocus}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          class={styles.input}
        />
        <span class={styles.unit}>{MODES.find((m) => m.key === mode())?.unit}</span>
      </label>
    </fieldset>
  );
}
