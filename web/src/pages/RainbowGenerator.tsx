import { createMemo } from "solid-js";
import { createSignal } from "solid-js";
import { RainbowDrawer } from "../components/RainbowDrawer.tsx";
import { Angle } from "../lib/angle.ts";
import AngleEditor from "../components/AngleEditor.tsx";
import ColorEditor from "../components/ColorEditor.tsx";
import styles from "./RainbowGenerator.module.css";

function RainbowGenerator() {
  const [colors, setColors] = createSignal<string[]>([
    "#00ff00",
    "#ff0000",
    "#0000ff",
  ]);

  const squareSize = 400;

  const [angle, setAngle] = createSignal<Angle>(new Angle(Math.PI * (1 / 9)));

  const height_sum = createMemo(
    () =>
      squareSize * (Math.sin(angle().radian) + Math.cos(angle().radian)),
  );
  const rectHeight = createMemo(() => height_sum() / colors().length);
  const rectWidth = createMemo(
    () =>
      squareSize / Math.cos(angle().radian) +
      2 * rectHeight() * Math.tan(angle().radian),
  );
  const y_offset = createMemo(() => rectHeight() / Math.cos(angle().radian));

  const previewScale = createMemo(() => {
    const maxDim = Math.max(rectWidth(), height_sum());
    return Math.min(1, 300 / maxDim);
  });

  return (
    <div class={styles.page}>
      <div class={styles.controls}>
        <AngleEditor angle={angle} setAngle={setAngle} />
        <ColorEditor colors={colors} setColors={setColors} />
        <section class={styles.stats}>
          <h3>计算结果</h3>
          <table>
            <tbody>
              <tr>
                <td>色条宽度</td>
                <td>{rectWidth().toFixed(1)} px</td>
              </tr>
              <tr>
                <td>色条高度</td>
                <td>{rectHeight().toFixed(1)} px</td>
              </tr>
              <tr>
                <td>总高度</td>
                <td>{height_sum().toFixed(1)} px</td>
              </tr>
              <tr>
                <td>色条数</td>
                <td>{colors().length}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
      <div class={styles.preview}>
        <RainbowDrawer
          colors={colors()}
          angle={angle()}
          squareSize={squareSize}
        />
      </div>
    </div>
  );
}

export default RainbowGenerator;
