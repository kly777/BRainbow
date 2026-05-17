import { Accessor, Setter } from "solid-js";
import { Angle } from "../lib/angle.ts";
import styles from "./AngleEditor.module.css";

interface Props {
  angle: Accessor<Angle>;
  setAngle: Setter<Angle>;
}

/** 从角度值分别提取 degree / radian / slope 字符串 */
function decompose(a: Angle) {
  return {
    deg: a.degree.toFixed(2),
    rad: a.radian.toFixed(4),
    slope: (Math.tan(a.radian) * 100).toFixed(2),
  };
}

/**
 * 角度编辑器 —— 支持三个维度互相同步：
 * - 角度（degree）
 * - 弧度（radian）
 * - 百分比坡度（slope %）
 *
 * 任意输入变化时自动计算其余两项。
 */
export default function AngleEditor(props: Props) {
  const vals = () => decompose(props.angle());

  const onDegree = (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v)) props.setAngle(new Angle((v * Math.PI) / 180));
  };

  const onRadian = (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v)) props.setAngle(new Angle(v));
  };

  const onSlope = (e: Event) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!isNaN(v)) props.setAngle(new Angle(Math.atan(v / 100)));
  };

  return (
    <fieldset class={styles.fieldset}>
      <legend>角度 / Angle</legend>
      <div class={styles.row}>
        <label class={styles.label}>
          角度
          <input
            type="number"
            step="0.1"
            value={vals().deg}
            onInput={onDegree}
            class={styles.input}
          />
          <span class={styles.unit}>°</span>
        </label>
        <label class={styles.label}>
          弧度
          <input
            type="number"
            step="0.001"
            value={vals().rad}
            onInput={onRadian}
            class={styles.input}
          />
          <span class={styles.unit}>rad</span>
        </label>
        <label class={styles.label}>
          坡度
          <input
            type="number"
            step="0.1"
            value={vals().slope}
            onInput={onSlope}
            class={styles.input}
          />
          <span class={styles.unit}>%</span>
        </label>
      </div>
    </fieldset>
  );
}
